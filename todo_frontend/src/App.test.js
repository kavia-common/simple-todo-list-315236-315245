import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders todo list header", () => {
  render(<App />);
  const title = screen.getByText(/todo list/i);
  expect(title).toBeInTheDocument();
});
