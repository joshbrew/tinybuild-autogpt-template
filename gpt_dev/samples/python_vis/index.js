async function fetchChart() {
  const response = await fetch('chart.png');
  if (!response.ok) {
    console.error('Failed to fetch chart image');
    return;
  }
  const blob = await response.blob();
  const imgURL = URL.createObjectURL(blob);
  const img = document.createElement('img');
  img.src = imgURL;
  document.body.appendChild(img);
}

fetchChart();
