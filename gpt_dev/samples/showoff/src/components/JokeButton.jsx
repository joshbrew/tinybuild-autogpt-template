import React from 'react';

export default function JokeButton({ fetchJoke, joke, loading, error }) {
  return (
    <>
      <button className="joke-btn" disabled={loading} onClick={fetchJoke}>
        {loading ? 'Fetching...' : 'Tell me a joke!'}
      </button>
      {joke && <pre className="joke">{joke}</pre>}
      {error && <div className="error">{error}</div>}
    </>
  );
}
