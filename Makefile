# rocq-web: Rocq 9.2 and coq-lsp compiled to WebAssembly with ocaml-emcc
# (https://github.com/rboudrouss/ocaml-emcc), and the web app that runs them.
#
#   make             both builds and the static site
#   make full        the full build in out/full/ (wasm64 and JSPI)
#   make compat      the compat build in out/compat/ (memory lowered to 32 bits)
#   make plugins     only the plugins of a build (BUILD=full or compat)
#   make dist        the static site in dist/
#   make serve       serve dist/ at http://localhost:$(PORT)/
#   make deploy      deploy dist/ to Cloudflare R2 and Pages (docs/deploying.md)
#   make env         this environment for a shell, eval "$(make -s env)"
#
# This Makefile is also an example of a large OCaml program built with
# ocaml-emcc. The dune project goes to C through c_of_ocaml, then to
# WebAssembly through emscripten. The plugins, OCaml libraries that Rocq
# loads at run time with Declare ML Module, are compiled from their bytecode
# archives into WebAssembly side modules.
#
# Variables (make VAR=...)
#   JOBS             plugins compiled in parallel (half the cores by default,
#                    to save memory)
#   STACK            emscripten's C stack (64MB by default for compat)
#   NO_TAIL_CALLS=1  compat without wasm tail calls (docs/status.md)
#   OCAML_EMCC_JOBS  parallel C compilation in ocaml-emcc (environment variable)
# The toolchain and deployment variables are described below.
# make -k keeps going past a plugin that fails.

SHELL := bash
.SHELLFLAGS := -euo pipefail -c
# Each recipe runs as a single script
.ONESHELL:
.DELETE_ON_ERROR:
.PHONY: all full compat build plugins side-modules dist serve cloudflare r2 pages deploy env FORCE

all: full compat dist

## The toolchain (docs/building.md) ##########################################

# The opam switch, with OCaml 5.4.1, rocq-core 9.2.0, js_of_ocaml, ocaml-emcc
# and the Rocq packages the site offers
SWITCH ?= rocq-web
# emsdk
EMSDK ?= $(HOME)/tools/emsdk
# c_of_ocaml, built separately (see ocaml-emcc's README)
C_OF_OCAML ?= $(HOME)/C_of_ocaml/_build/default/compiler/bin-c_of_ocaml/c_of_ocaml.exe
# node 24 or later (for wasm64 and JSPI), taken from nvm if present
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

# Prints this environment for a shell
env:
	@for v in PATH OPAMSWITCH OPAM_SWITCH_PREFIX CAML_LD_LIBRARY_PATH OCAML_TOPLEVEL_PATH EMSDK OCAML_EMCC_C_OF_OCAML; do
	  if [ -n "$${!v-}" ]; then printf 'export %s=%q\n' "$$v" "$${!v}"; fi
	done

## A build ###################################################################

BUILD ?= full
OUT := out/$(BUILD)
OCAML_EMCC ?= ocaml-emcc
JOBS ?= $(shell echo $$(( ($$(nproc) + 1) / 2 )))

# Both builds compile the same 64-bit code, with 63-bit OCaml integers and
# the same .vo files. They differ in how that code runs.
#
# full uses a wasm64 memory, and JSPI for OCaml's effects and deep stacks.
#
# compat has its memory lowered to 32 bits by binaryen (emscripten's
# MEMORY64=2, for the program and its plugins) and uses a CPS stack instead
# of JSPI. Deep recursions in CPS still grow emscripten's C stack through
# over-applications and C functions, so that stack is the limit. It is
# 64 MB because 8 MB overflows on Eval compute in Nat.even (Nat.pow 3 11),
# 177147 calls deep. The stack is checked, so an overflow aborts instead of
# overwriting the static data below it, at no measurable cost.
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

# coq-lsp for Rocq 9.2 is not in opam. Its recipe, emcc-recipes/coq-lsp/,
# names its sources and the patches rocq-web needs (see each patch).
# ocaml-emcc builds its OCaml libraries for the target from them, before
# the programs, into the sysroot's findlib directory, where the toolchain
# finds them before the switch's packages.
SYSROOT = $(eval SYSROOT := $$(shell $(OCAML_EMCC) $(TARGET) env --sysroot))$(SYSROOT)
OCAMLFIND = OCAMLFIND_CONF=$(SYSROOT)/findlib.conf ocamlfind -toolchain wasm64

full compat:
	$(MAKE) build BUILD=$@

# out/BUILD/ holds the programs (built three at a time), the plugins, and
# web/, what the page serves (the worker and Rocq's files, see
# scripts/assets.mjs)
build:
	$(MAKE) -j3 $(OUT)/rocq_web.js $(OUT)/lsp_worker.js $(OUT)/web/lsp_worker.js
	$(MAKE) plugins
	node scripts/assets.mjs $(BUILD) $(OUT)/web

### The programs. ocaml-emcc builds a dune executable (--exe) into FILE.js
### and FILE.wasm. These targets always run, since dune and ocaml-emcc know
### what changed.

# Rocq (rocq compile, rocq repl) under node, using the host's files
# (--node-fs). The tests compare it with native Rocq.
$(OUT)/rocq_web.js: FORCE
	$(OCAML_EMCC) $(TARGET) build $@ --exe worker/rocq_web $(LINK) --node-fs

# coq-lsp's server under node. The tests use it, and it is the main program
# the plugins are linked against (--main below).
$(OUT)/lsp_worker.js: FORCE
	$(OCAML_EMCC) $(TARGET) build $@ --exe worker/lsp_worker $(LINK) --node-fs \
	  -- --pre-js web/rocq-web-io.js

# The same for a Web Worker, with its messages (web/rocq-web-io.js) and
# Rocq's files in emscripten's file system, fetched from the site
# (web/rocq-web-fs.js)
$(OUT)/web/lsp_worker.js: FORCE
	$(OCAML_EMCC) $(TARGET) build $@ --exe worker/lsp_worker $(LINK) \
	  -- --pre-js web/rocq-web-io.js --pre-js web/rocq-web-fs.js -sENVIRONMENT=web,worker -sFORCE_FILESYSTEM=1

### The plugins, side modules named after their findlib package, in
### $(OUT)/plugins/. They are the plugins the switch's libraries declare
### (Declare ML Module), coq-lsp's serlib plugins, and the packages these
### need that the worker does not link (elpi for rocq-elpi...). A serlib
### plugin (coq-lsp.serlib.PLUGIN) is coq-lsp's serialization of a plugin's
### syntax. It is loaded instead of the plugin, and requires it.

# The packages are those of the target's toolchain (OCAMLFIND), whose
# coq-lsp is the recipe's. The plugins run in a separate make, which lists
# them once the programs are built.
plugins:
	$(MAKE) -j$(JOBS) side-modules

ifeq ($(MAKECMDGOALS),side-modules)
COQLIB := $(OPAM_SWITCH_PREFIX)/lib/coq
DECLARED := $(shell grep -rhoE 'Declare ML Module "[^"]+"' $(COQLIB) | sed 's/.*"\(.*\)"/\1/')
SERLIB := $(shell $(OCAMLFIND) list 2>/dev/null | awk '$$1 ~ /^coq-lsp\.serlib\./ { print $$1 }')
# The plugins and the packages they need, dependencies first
NEEDED := $(shell $(OCAMLFIND) query -r -format '%p' $(sort $(DECLARED) $(SERLIB)) | awk '!seen[$$0]++')
# The packages linked into the worker, the libraries of lsp_worker
# (worker/dune) and their dependencies
libraries = sed -n '/(name lsp_worker)/,/^$$/p' worker/dune | sed -n '/(libraries/,$$p' | tr -d '()'
WORKER_LIBS := $(filter-out libraries rocq_web_plugins lsp_io,$(shell $(libraries)))
LINKED := $(shell $(OCAMLFIND) query -r -format '%p' $(WORKER_LIBS) findlib ocaml-emcc.dynlink)
# The others that have OCaml code, meaning a bytecode archive (fake.cma
# means none)
archive-name = $(shell $(OCAMLFIND) query -predicates byte -format %a $(1))
PLUGINS := $(foreach p,$(filter-out $(LINKED),$(NEEDED)),$(if $(filter-out fake.cma,$(call archive-name,$(p))),$(p)))

# A package's bytecode archive, in the sysroot or the switch, or built
# below when opam installed it as native code only
archive = $(call installed-or-byte,$(shell $(OCAMLFIND) query -predicates byte -format %d/%a $(1)))
installed-or-byte = $(if $(wildcard $(1)),$(1),_build/byte-plugins/$(notdir $(patsubst %/,%,$(dir $(1))))/$(notdir $(1)))

side-modules: $(PLUGINS:%=$(OUT)/plugins/%.wasm)
	$(if $(wildcard $(LINKED:%=$(OUT)/plugins/%.wasm)),rm -f $(wildcard $(LINKED:%=$(OUT)/plugins/%.wasm)))
endif

# A plugin from its archive, linked against the program that loads it
# (--main gives the symbols it exports). Rebuilt when the program changes.
.SECONDEXPANSION:
$(OUT)/plugins/%.wasm: $$(strip $$(call archive,$$*)) $(OUT)/lsp_worker.wasm
	mkdir -p $(@D)
	$(OCAML_EMCC) $(TARGET) plugin $(PLUGIN) $< -o $@ --main $(OUT)/lsp_worker.js

# The bytecode archive of a plugin that opam installs as native code only
# (DIR/ is its findlib directory). coq_makefile builds a plugin's .cma only
# with `make byte`, which opam packages do not run. So the sources of the
# opam package are fetched into _src/byte/PACKAGE and only its plugins are
# compiled to bytecode (coq_makefile's bytefiles target). When the plugins
# need the package's own build first (generated code, a configure script),
# prebuild.PACKAGE runs it. Otherwise they are compiled from the _CoqProject.
_build/byte-plugins/%.cma: PACKAGE = $(basename $(notdir $(firstword \
  $(shell grep -l '"lib/$(*D)/' $(OPAM_SWITCH_PREFIX)/.opam-switch/install/*.changes))))
# The installed version, since opam source may pick a newer one
_build/byte-plugins/%.cma: VERSION = $(notdir $(firstword $(wildcard $(OPAM_SWITCH_PREFIX)/.opam-switch/packages/$(PACKAGE).*)))
prebuild.rocq-metarocq-template = bash ./configure.sh && make -C template-rocq
prebuild.rocq-relation-algebra = ./configure --enable-ssr --enable-aac && make

_build/byte-plugins/%.cma:
	echo "$(@F) from $(PACKAGE)"
	src=$(CURDIR)/_src/byte/$(PACKAGE)
	# The plugins of a package share its sources and its prebuild, so they
	# are built one at a time (with make -j, two of them would generate the
	# same files at once)
	mkdir -p "$${src%/*}"
	exec 9> "$$src.lock"
	flock 9
	[ -d "$$src" ] || opam source $(VERSION) --dir "$$src" > /dev/null
	cd "$$src"
	built() { find . -name $(@F) | head -1; }
	prebuild='$(prebuild.$(PACKAGE))'
	if [ -z "$$(built)" ] && [ -n "$$prebuild" ] && (eval "$$prebuild") > /dev/null; then
	  # bytefiles of every makefile that rocq makefile wrote
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

# The built app and each build's out/BUILD/web, with brotli copies
dist:
	node scripts/dist.mjs

# Serves the site as it must be served, cross-origin isolated and compressed
serve:
	node scripts/serve.mjs dist $(PORT)

# On Cloudflare, files over 25 MiB go to an R2 bucket served at ASSETS_URL,
# and the rest to Pages
ASSETS_URL ?= https://rocq-wasm.rboud.com
BUCKET ?= rocqweb
PROJECT ?= rocqweb
WRANGLER ?= npx wrangler

deploy:
	$(MAKE) dist
	$(MAKE) cloudflare
	$(MAKE) r2
	$(MAKE) pages

# dist-cloudflare/ holds the site without those files, dist-r2/HASH/ holds them
cloudflare:
	node scripts/cloudflare.mjs $(ASSETS_URL)

# Uploads dist-r2/ to the bucket, compressed (Content-Encoding: br) when
# FILE.br exists, and cached for good since their directory changes with
# them. Can be skipped when the programs did not change (dist-r2/ then has
# the same HASH).
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
