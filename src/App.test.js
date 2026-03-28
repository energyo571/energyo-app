import { render, screen } from "@testing-library/react";
import App from "./App";

jest.mock("./firebaseConfig", () => ({
  auth: {},
  db: {},
  storage: {},
}));

jest.mock("firebase/auth", () => ({
  onAuthStateChanged: jest.fn((_auth, callback) => {
    callback(null);
    return jest.fn();
  }),
  signOut: jest.fn(),
}));

test("renders login form", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: /energyo - sales engine/i })).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/e-mail/i)).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/passwort/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /anmelden/i })).toBeInTheDocument();
});
