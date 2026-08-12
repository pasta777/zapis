import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
// Ignore missing type declarations for CSS imports in this project setup
// @ts-ignore: Implicit any for CSS module
import "./styles.css";

const host = document.getElementById("root");
if (!host) throw new Error("#root is missing from index.html");

createRoot(host).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
