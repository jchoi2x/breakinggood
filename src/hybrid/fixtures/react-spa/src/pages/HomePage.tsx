import { useNavigate } from "react-router-dom";

export function HomePage() {
  const navigate = useNavigate();

  function goAbout() {
    navigate("/about");
  }

  async function loadItems() {
    const res = await fetch("/api/items");
    await res.json();
  }

  return (
    <main>
      <h1>Home</h1>
      <button type="button" data-testid="go-about" onClick={goAbout}>
        About
      </button>
      <button type="button" aria-label="Load items" onClick={loadItems}>
        Load
      </button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <input name="q" onChange={() => undefined} />
        <button type="submit">Search</button>
      </form>
    </main>
  );
}
