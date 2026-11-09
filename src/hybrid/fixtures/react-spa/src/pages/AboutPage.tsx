export function AboutPage() {
  const handler = getHandler();

  return (
    <main>
      <h1>About</h1>
      <button type="button" onClick={handler}>
        Dynamic action
      </button>
      <button type="button" onClick={() => console.log("noop")}>
        Log out
      </button>
    </main>
  );
}

function getHandler() {
  return () => undefined;
}
