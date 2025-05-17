//IMPORT ALL DEPENDENCIES THROUGH INDEX.JS FOR STREAMLINED BUNDLING
import './index.css' //ESBUILD CONVENTION FOR BUNDLING CSS. ALL CSS WILL COMPILE TO INDEX.CSS (based on current filename)

// Create a container element for displaying time
const timeContainer = document.createElement('div');
timeContainer.id = 'time-container';
timeContainer.style.fontFamily = 'monospace';
timeContainer.style.fontSize = '2rem';
timeContainer.style.marginTop = '1rem';
document.body.appendChild(timeContainer);

// Create WebSocket connection to ws://localhost:6000
const socket = new WebSocket('ws://localhost:6005');

socket.onopen = () => {
  console.log('WebSocket connected to ws://localhost:6005');
};

socket.onmessage = (event) => {
  // Update the page with the latest time from the server
  timeContainer.textContent = 'Current time: ' + event.data;
};

socket.onerror = (error) => {
  console.error('WebSocket error:', error);
};

socket.onclose = (event) => {
  console.log(`WebSocket connection closed: code=${event.code}, reason=${event.reason}`);
};

// Add a greeting message to the page body
const greeting = document.createElement('div');
greeting.textContent = 'HELLO WORLD!';
greeting.style.fontWeight = 'bold';
greeting.style.fontSize = '3rem';
document.body.insertBefore(greeting, timeContainer);
