import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js'; // Imports the master application file

// Get the root element from public/index.html
const rootElement = document.getElementById('root');

if (rootElement) {
    // Create the root container and render the App component
    const root = ReactDOM.createRoot(rootElement);
    
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
} else {
    console.error("The root element 'div id=\"root\"' was not found in index.html.");
}
