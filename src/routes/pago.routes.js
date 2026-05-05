const express = require('express');
const router = express.Router();

const {
  listarFuncionarios,
  crearBoleta,
  listarBoletas,
  obtenerBoletaPorId,
  obtenerBoletasPorFuncionario,
  enviarBoletaCorreo,
  eliminarBoleta
} = require('../controllers/pago.controller');

router.get('/funcionarios', listarFuncionarios);

router.post('/', crearBoleta);
router.get('/', listarBoletas);

router.get('/funcionario/:idFuncionario/lista', obtenerBoletasPorFuncionario);

router.get('/:id', obtenerBoletaPorId);
router.post('/:id/enviar-correo', enviarBoletaCorreo);
router.delete('/:id', eliminarBoleta);

module.exports = router;