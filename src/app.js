const express = require('express');
const cors = require('cors');
const pagoRoutes = require('./routes/pago.routes');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    ok: true,
    msg: 'Microservicio de boletas de pago funcionando'
  });
});

app.use('/api/pagos', pagoRoutes);

module.exports = app;