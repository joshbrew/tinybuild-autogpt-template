// Main entry file: mounts the App component
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './src/App.jsx';
import './index.css';

// This sets up a #root div and attaches your app—no UI logic here.
const container = document.createElement('div');
container.id = 'root';
document.body.appendChild(container);
createRoot(container).render(<App />);
