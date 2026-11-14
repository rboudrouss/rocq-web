# rocq-web: Rocq 9.2 and its language server, coq-lsp, compiled to
# WebAssembly by ocaml-emcc (https://github.com/rboudrouss/ocaml-emcc),
# and the web app that runs them in a Web Worker.
#
# Also an example of a large OCaml program built with ocaml-emcc: its
# dune project compiled to C by c_of_ocaml, then to WebAssembly by
# emscripten, and its plugins (OCaml libraries loaded at run time, by
# Rocq's Declare ML Module) compiled from their bytecode archives to
# WebAssembly side modules that the program loads.
#
#   make                  both builds and the static site
#   make full             a build (docs/design.md): out/full/, wasm64 + JSPI
#   make compat           out/compat/: the same, memory64 lowered to wasm32
#   make plugins          the plugins of a build only (BUILD=full or compat)
#   make dist             the static site: dist/
#   make serve            dist/ at http://localhost:$(PORT)/
#   make deploy           dist/ on Cloudflare: R2 and Pages (docs/deploying.md)
#   make env              this environment, for a shell: eval "$(make -s env)"
#
# Variables (make VAR=...):
#   JOBS            plugins compiled at a time (default: half the cores,
#                   for the memory)
#   STACK           emscripten's C stack (compat: 64MB by default)
#   NO_TAIL_CALLS=1 compat without wasm tail calls (docs/status.md)
#   OCAML_EMCC_JOBS (environment) ocaml-emcc's parallel compilation of C
# and those of the toolchain and of deploying below. make -k goes on past
# a plugin that fails.

SHELL := bash
.SHELLFLAGS := -euo pipefail -c
# (each recipe one script)
.ONESHELL:
.DELETE_ON_ERROR:
.PHONY: all full compat build plugins side-modules vendor dist serve cloudflare r2 pages deploy env FORCE

all: full compat dist

## The toolchain (docs/building.md) ##########################################

# The opam switch: OCaml 5.4.1, rocq-core 9.2.0, the Rocq packages the site
# offers, js_of_ocaml, ocaml-emcc
SWITCH ?= rocq-web
# emscripten
EMSDK ?= $(HOME)/tools/emsdk
# c_of_ocaml, built apart (ocaml-emcc's README)
C_OF_OCAML ?= $(HOME)/C_of_ocaml/_build/default/compiler/bin-c_of_ocaml/c_of_ocaml.exe
# node 24 or later (wasm64, JSPI), from nvm if there
NODE_DIR ?= $(lastword $(sort $(wildcard $(HOME)/.nvm/versions/node/v2[4-9]*/bin)))

OPAM_SWITCH_PREFIX := $(shell opam var prefix --switch=$(SWITCH))
export OPAMSWITCH := $(SWITCH)
export OPAM_SWITCH_PREFIX EMSDK
export CAML_LD_LIBRARY_PATH := $(OPAM_SWITCH_PREFIX)/lib/stublibs:$(OPAM_SWITCH_PREFIX)/lib/ocaml/stublibs
export OCAML_TOPLEVEL_PATH := $(OPAM_SWITCH_PREFIX)/lib/toplevel
export PATH := $(if $(NODE_DIR),$(NODE_DIR):)$(OPAM_SWITCH_PREFIX)/bin:$(EMSDK):$(EMSDK)/upstream/emscripten:$(PATH)
ifneq ($(wildcard $(C_OF_OCAML)),)
export OCAML_EMCC_C_OF_OCAML ?= $(C_OF_OCAML)
endif

# This environment, for a shell
env:
	@for v in PATH OPAMSWITCH OPAM_SWITCH_PREFIX CAML_LD_LIBRARY_PATH OCAML_TOPLEVEL_PATH EMSDK OCAML_EMCC_C_OF_OCAML; do
	  if [ -n "$${!v-}" ]; then printf 'export %s=%q\n' "$$v" "$${!v}"; fi
	done

## A build ###################################################################

BUILD ?= full
OUT := out/$(BUILD)
OCAML_EMCC ?= ocaml-emcc
JOBS ?= $(shell echo $$(( ($$(nproc) + 1) / 2 )))

# Both builds compile the same 64-bit code (63-bit OCaml integers, the
# same .vo files); they differ in how it runs:
# - full: wasm64 memory, and JSPI for OCaml's effects and deep stacks;
# - compat: the memory lowered to 32 bits by binaryen (emscripten's
#   MEMORY64=2, for the program and its plugins), and a CPS stack instead
#   of JSPI. Deep recursions in CPS leave emscripten's C stack, which they
#   still grow (over-applications, C functions), as the limit: 64 MB
#   (8 MB overflows on Eval compute in Nat.even (Nat.pow 3 11), 177147
#   deep), checked (an overflow aborts instead of writing over the static
#   data below it), at no measured cost.
TARGET := --target wasm64
ifeq ($(BUILD),full)
LINK := --jspi $(if $(STACK),--stack-size $(STACK))
else ifeq ($(BUILD),compat)
PLUGIN := $(if $(NO_TAIL_CALLS),--no-tail-calls)
LINK := --cps-stack $(PLUGIN) --stack-size $(or $(STACK),64MB) --emcc-flag -sSTACK_OVERFLOW_CHECK=2
export EMCC_CFLAGS += -sMEMORY64=2
else
$(error BUILD: full or compat)
endif

# dune's context of the target, where coq-lsp's packages are installed:
# findlib finds them there
CTX := default.wasm64
export OCAMLPATH := $(CURDIR)/_build/install/$(CTX)/lib

full compat:
	$(MAKE) build BUILD=$@

# out/BUILD/: the programs (three at a time), the plugins, and web/, what
# the page serves (the worker, Rocq's files: scripts/assets.mjs)
build: vendor
	$(MAKE) -j3 $(OUT)/rocq_web.js $(OUT)/lsp_worker.js $(OUT)/web/lsp_worker.js
	$(MAKE) plugins
	node scripts/assets.mjs $(BUILD) $(OUT)/web

# coq-lsp in vendor/, with patches/coq-lsp/ applied (once: a patch already
# applied is skipped)
vendor:
	git submodule update --init
	for p in patches/coq-lsp/*.patch; do
	  if git -C vendor/coq-lsp apply --reverse --check "$(CURDIR)/$$p" 2>/dev/null; then continue; fi
	  git -C vendor/coq-lsp apply "$(CURDIR)/$$p"
	  echo "applied $$p"
	done

### The programs: ocaml-emcc builds a dune executable (--exe) into FILE.js
### and FILE.wasm. Always run: dune and ocaml-emcc know what changed.

# Rocq (rocq compile, rocq repl) under node, with the host's files
# (--node-fs): the tests compare it with the native Rocq
$(OUT)/rocq_web.js: FORCE
	$(OCAML_EMCC) $(TARGET) build $@ --exe worker/rocq_web $(LINK) --node-fs

# coq-lsp's server under node: the tests, and the main program the plugins
# are linked against (--main below)
$(OUT)/lsp_worker.js: FORCE
	$(OCAML_EMCC) $(TARGET) build $@ --exe worker/lsp_worker $(LINK) --node-fs \
	  -- --pre-js web/rocq-web-io.js

# The same for a Web Worker: its messages (web/rocq-web-io.js), Rocq's
# files in emscripten's file system, fetched from the site
# (web/rocq-web-fs.js)
$(OUT)/web/lsp_worker.js: FORCE
	$(OCAML_EMCC) $(TARGET) build $@ --exe worker/lsp_worker $(LINK) \
	  -- --pre-js web/rocq-web-io.js --pre-js web/rocq-web-fs.js -sENVIRONMENT=web,worker -sFORCE_FILESYSTEM=1

### The plugins: side modules named after their findlib package, in
### $(OUT)/plugins/. Those the libraries of the switch declare (Declare ML
### Module), coq-lsp's serlib plugins (coq-lsp.serlib.PLUGIN: its
### serialization of a plugin's syntax, loaded instead of the plugin,
### which it requires), and the packages they need that the worker does
### not link (elpi for rocq-elpi...).

# First coq-lsp's serlib plugins, by dune, then (a make of its own: the
# list of the plugins needs their META) each plugin
plugins: vendor
	$(OCAML_EMCC) $(TARGET) dune @vendor/coq-lsp/serlib/plugins/all _build/install/$(CTX)/lib/coq-lsp/META
	$(MAKE) -j$(JOBS) side-modules

ifeq ($(MAKECMDGOALS),side-modules)
COQLIB := $(OPAM_SWITCH_PREFIX)/lib/coq
DECLARED := $(shell grep -rhoE 'Declare ML Module "[^"]+"' $(COQLIB) | sed 's/.*"\(.*\)"/\1/')
SERLIB := $(shell ocamlfind list 2>/dev/null | awk '$$1 ~ /^coq-lsp\.serlib\./ { print $$1 }')
# with the packages they need, those first
NEEDED := $(shell ocamlfind query -r -format '%p' $(sort $(DECLARED) $(SERLIB)) | awk '!seen[$$0]++')
# The packages linked in the worker: the libraries of lsp_worker
# (worker/dune) and those they need
libraries = sed -n '/(name lsp_worker)/,/^$$/p' worker/dune | sed -n '/(libraries/,$$p' | tr -d '()'
WORKER_LIBS := $(filter-out libraries rocq_web_plugins lsp_io,$(shell $(libraries)))
LINKED := $(shell ocamlfind query -r -format '%p' $(WORKER_LIBS) findlib ocaml-emcc.dynlink)
# The others with OCaml code: a bytecode archive (fake.cma: none)
archive-name = $(shell ocamlfind query -predicates byte -format %a $(1))
PLUGINS := $(foreach p,$(filter-out $(LINKED),$(NEEDED)),$(if $(filter-out fake.cma,$(call archive-name,$(p))),$(p)))

# A package's bytecode archive: coq-lsp's in _build; the switch's; or, when
# opam installed it native only, the one built below
archive = $(if $(filter coq-lsp.%,$(1)), \
  $(firstword $(shell find _build/$(CTX)/vendor/coq-lsp -name $(call archive-name,$(1)))), \
  $(call installed-or-byte,$(shell ocamlfind query -predicates byte -format %d/%a $(1))))
installed-or-byte = $(if $(wildcard $(1)),$(1),_build/byte-plugins/$(notdir $(patsubst %/,%,$(dir $(1))))/$(notdir $(1)))

side-modules: $(PLUGINS:%=$(OUT)/plugins/%.wasm)
	$(if $(wildcard $(LINKED:%=$(OUT)/plugins/%.wasm)),rm -f $(wildcard $(LINKED:%=$(OUT)/plugins/%.wasm)))
endif

# A plugin from its archive, linked against the program that loads it
# (--main: the symbols it exports), again when the program changed
.SECONDEXPANSION:
$(OUT)/plugins/%.wasm: $$(strip $$(call archive,$$*)) $(OUT)/lsp_worker.wasm
	mkdir -p $(@D)
	$(OCAML_EMCC) $(TARGET) plugin $(PLUGIN) $< -o $@ --main $(OUT)/lsp_worker.js

# The bytecode archive of a plugin that opam installs native only (DIR/
# its findlib directory): coq_makefile builds a plugin's .cma only with
# `make byte`, which an opam package does not run. The sources of its opam
# package, in _src/byte/PACKAGE, are compiled to bytecode, plugins only
# (coq_makefile's bytefiles), once the package's own build when its
# plugins need it (generated code, a configure script: prebuild.PACKAGE),
# else from its _CoqProject.
_build/byte-plugins/%.cma: PACKAGE = $(basename $(notdir $(firstword \
  $(shell grep -l '"lib/$(*D)/' $(OPAM_SWITCH_PREFIX)/.opam-switch/install/*.changes))))
# (the version installed: opam source may take a newer one)
_build/byte-plugins/%.cma: VERSION = $(notdir $(firstword $(wildcard $(OPAM_SWITCH_PREFIX)/.opam-switch/packages/$(PACKAGE).*)))
prebuild.rocq-metarocq-template = bash ./configure.sh && make -C template-rocq
prebuild.rocq-relation-algebra = ./configure --enable-ssr --enable-aac && make

_build/byte-plugins/%.cma:
	echo "$(@F) from $(PACKAGE)"
	src=$(CURDIR)/_src/byte/$(PACKAGE)
	[ -d "$$src" ] || opam source $(VERSION) --dir "$$src" > /dev/null
	cd "$$src"
	built() { find . -name $(@F) | head -1; }
	prebuild='$(prebuild.$(PACKAGE))'
	if [ -z "$$(built)" ] && [ -n "$$prebuild" ] && (eval "$$prebuild") > /dev/null; then
	  # the plugins of each makefile rocq makefile wrote
	  for mk in $$(grep -rl --include='*akefile*' '^bytefiles:' .); do
	    (cd "$$(dirname "$$mk")" && nice -n19 $(MAKE) -f "$$(basename "$$mk")" bytefiles > /dev/null) || true
	  done
	fi
	if [ -z "$$(built)" ]; then
	  for project in _CoqProject* _RocqProject*; do
	    if [ -f "$$project" ] && grep -qE '\.(mllib|mlpack)' "$$project"; then
	      (rocq makefile -f "$$project" -o Makefile.rocq-web-byte > /dev/null &&
	        nice -n19 $(MAKE) -f Makefile.rocq-web-byte bytefiles) || true
	    fi
	  done
	fi
	if [ -z "$$(built)" ]; then echo "$(PACKAGE): no $(@F) built" >&2; exit 1; fi
	mkdir -p $(CURDIR)/$(@D)
	cp "$$(built)" $(CURDIR)/$@

FORCE:

## The site (docs/deploying.md) ##############################################

PORT ?= 8080

# The app built, and each build's out/BUILD/web, with their brotli
# compression
dist:
	node scripts/dist.mjs

# As the site must be served: cross-origin isolated, compressed
serve:
	node scripts/serve.mjs dist $(PORT)

# On Cloudflare: the files over 25 MiB in an R2 bucket, served at
# ASSETS_URL, the rest by Pages
ASSETS_URL ?= https://rocq-wasm.rboud.com
BUCKET ?= rocqweb
PROJECT ?= rocqweb
WRANGLER ?= npx wrangler

deploy:
	$(MAKE) dist
	$(MAKE) cloudflare
	$(MAKE) r2
	$(MAKE) pages

# dist-cloudflare/, the site without those files; dist-r2/HASH/, them
cloudflare:
	node scripts/cloudflare.mjs $(ASSETS_URL)

# dist-r2/ into the bucket, compressed (Content-Encoding: br) when FILE.br
# exists, cached for good (their directory changes with them). Can be
# skipped when the programs did not change (dist-r2/ has the same HASH)
r2:
	for file in $$(find dist-r2 -type f ! -name '*.br' | sort); do
	  key=$${file#dist-r2/}
	  case $$file in
	    *.wasm) type=application/wasm ;;
	    *.js) type=text/javascript ;;
	    *.json) type=application/json ;;
	    *) type=application/octet-stream ;;
	  esac
	  enc=()
	  if [ -f "$$file.br" ]; then file=$$file.br; enc=(--content-encoding br); fi
	  $(WRANGLER) r2 object put "$(BUCKET)/$$key" --remote --file "$$file" --content-type "$$type" "$${enc[@]}" \
	    --cache-control "public, max-age=31536000, immutable"
	done

# dist-cloudflare/ as the production deployment of the Pages project
pages:
	$(WRANGLER) pages deploy dist-cloudflare --project-name $(PROJECT) --branch main
