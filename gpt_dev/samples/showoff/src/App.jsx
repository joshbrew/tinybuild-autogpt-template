import React, { useState } from 'react';
import Clock from './components/Clock';
import JokeButton from './components/JokeButton';
import ShowOff from './ShowOff';

export default function App() {
  const [joke, setJoke] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function fetchJoke() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('https://official-joke-api.appspot.com/random_joke');
      if (!res.ok) throw new Error('API Error');
      const data = await res.json();
      setJoke(`${data.setup}\n${data.punchline}`);
    } catch {
      setError('Failed to load a joke.');
    }
    setLoading(false);
  }

  return (
    <div className="impressive-bg impressive-container">
      <h1>🚀 Welcome to Your Impressive React Dashboard! 🚀</h1>
      <ShowOff />
      <Clock />
      <JokeButton fetchJoke={fetchJoke} joke={joke} loading={loading} error={error} />
      <footer>Proudly built with React and GPT automation ✨</footer>
    </div>
  );
}
