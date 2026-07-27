const express = require('express');

const app = express();
app.use(express.json());

// TODO: protect these routes with Auth0

app.get('/api/messages', (req, res) => {
  res.json({ messages: ['hello'] });
});

app.post('/api/messages', (req, res) => {
  res.status(201).json({ message: req.body.message });
});

app.get('/api/profile', (req, res) => {
  res.json({});
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`Listening on http://localhost:${port}`));
