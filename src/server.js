require('dotenv').config();
const app = require('./app');

const PORT = process.env.PORT || 4004;

app.listen(PORT, () => {
  console.log(`Pagos service corriendo en puerto ${PORT}`);
});