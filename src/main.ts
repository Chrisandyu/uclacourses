import { mount } from "svelte";
import App from "./App.svelte";
import { start } from "./store.svelte";
import "./theme.css";

mount(App, { target: document.body });
start();
