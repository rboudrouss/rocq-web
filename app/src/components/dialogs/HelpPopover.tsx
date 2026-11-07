// The keyboard shortcuts
const shortcuts = [
  ["Alt+Enter, Ctrl+Enter", "Check up to the cursor"],
  ["Alt+N, Alt+P", "Next or previous sentence (checked)"],
  ["F8, Shift+F8", "Next or previous error or warning"],
  ["F12, Ctrl+click", "Go to the definition"],
  ["Ctrl+Space", "Complete a name, or a symbol after a backslash (\\forall)"],
  ["Right click (files)", "New file or folder, import, workspaces, rename, download"],
];

export function HelpPopover({ close }: { close: () => void }) {
  return (
    <div className="help" onClick={close}>
      <table>
        <tbody>
          {shortcuts.map(([k, what]) => (
            <tr key={k}>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td>{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
