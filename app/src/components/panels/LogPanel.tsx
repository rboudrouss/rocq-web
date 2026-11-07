// The log: the worker's messages, the files compiled, errors
export function LogPanel({ lines }: { lines: string[] }) {
  return (
    <div className="log">
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}
