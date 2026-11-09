import { RouterProvider, createBrowserRouter, Route } from "react-router-dom";
import { HomePage } from "./pages/HomePage.js";
import { AboutPage } from "./pages/AboutPage.js";

const router = createBrowserRouter([
  {
    path: "/",
    element: <HomePage />,
  },
  {
    path: "/about",
    element: <AboutPage />,
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
