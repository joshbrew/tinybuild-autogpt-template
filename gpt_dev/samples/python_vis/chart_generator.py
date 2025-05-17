import matplotlib.pyplot as plt

# Generate a simple chart and save it locally
x = [1, 2, 3, 4, 5]
y = [2, 3, 5, 7, 11]

plt.figure()
plt.plot(x, y, marker='o')
plt.title('Sample Chart')
plt.xlabel('X-axis')
plt.ylabel('Y-axis')
plt.savefig('chart.png')
plt.close()
