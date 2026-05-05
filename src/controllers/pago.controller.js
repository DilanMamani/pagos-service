const pool = require('../config/db');
const { enviarCorreoBoleta } = require('../services/correo.service');

const obtenerMesTexto = (mes) => {
  const meses = {
    1: 'Enero',
    2: 'Febrero',
    3: 'Marzo',
    4: 'Abril',
    5: 'Mayo',
    6: 'Junio',
    7: 'Julio',
    8: 'Agosto',
    9: 'Septiembre',
    10: 'Octubre',
    11: 'Noviembre',
    12: 'Diciembre'
  };

  return meses[Number(mes)] || mes;
};

const formatearMonto = (monto) => {
  return `Bs ${Number(monto || 0).toFixed(2)}`;
};

const listarFuncionarios = async (req, res) => {
  try {
    const result = await pool.query(`
      select
        f.id_funcionario,
        f.nombres,
        f.apellidos,
        f.ci,
        f.correo,
        f.telefono,
        f.remuneracion,
        f.fecha_ingreso,
        f.ratificado,
        f.activo,
        a.nombre as area,
        c.nombre as cargo
      from funcionario f
      left join area a on f.id_area = a.id_area
      left join cargo c on f.id_cargo = c.id_cargo
      where f.activo = true
      order by f.id_funcionario asc
    `);

    res.json({
      ok: true,
      funcionarios: result.rows
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: 'Error al listar funcionarios',
      error: error.message
    });
  }
};

const crearBoleta = async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      id_funcionario,
      mes,
      gestion,
      sueldo_basico,
      bonos = [],
      descuentos = []
    } = req.body;

    if (!id_funcionario || !mes || !gestion || !sueldo_basico) {
      return res.status(400).json({
        ok: false,
        msg: 'Faltan datos obligatorios: id_funcionario, mes, gestion y sueldo_basico'
      });
    }

    const funcionarioResult = await client.query(
      `
      select
        f.id_funcionario,
        f.nombres,
        f.apellidos,
        f.ci,
        f.correo,
        f.telefono,
        f.remuneracion,
        f.activo,
        a.nombre as area,
        c.nombre as cargo
      from funcionario f
      left join area a on f.id_area = a.id_area
      left join cargo c on f.id_cargo = c.id_cargo
      where f.id_funcionario = $1
      `,
      [id_funcionario]
    );

    if (funcionarioResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        msg: 'Funcionario no encontrado'
      });
    }

    const funcionario = funcionarioResult.rows[0];

    if (!funcionario.activo) {
      return res.status(400).json({
        ok: false,
        msg: 'No se puede generar boleta para un funcionario inactivo'
      });
    }

    const totalBonos = bonos.reduce((sum, item) => sum + Number(item.monto || 0), 0);
    const totalDescuentos = descuentos.reduce((sum, item) => sum + Number(item.monto || 0), 0);
    const totalPagado = Number(sueldo_basico) + totalBonos - totalDescuentos;

    await client.query('begin');

    const boletaResult = await client.query(
      `
      insert into boleta_pago (
        id_funcionario,
        mes,
        gestion,
        sueldo_basico,
        total_bonos,
        total_descuentos,
        total_pagado
      )
      values ($1, $2, $3, $4, $5, $6, $7)
      returning *
      `,
      [
        id_funcionario,
        mes,
        gestion,
        sueldo_basico,
        totalBonos,
        totalDescuentos,
        totalPagado
      ]
    );

    const boleta = boletaResult.rows[0];

    const detalleCreado = [];

    for (const bono of bonos) {
      const detalleResult = await client.query(
        `
        insert into detalle_boleta (id_boleta, tipo, concepto, monto)
        values ($1, 'bono', $2, $3)
        returning *
        `,
        [boleta.id_boleta, bono.concepto, bono.monto]
      );

      detalleCreado.push(detalleResult.rows[0]);
    }

    for (const descuento of descuentos) {
      const detalleResult = await client.query(
        `
        insert into detalle_boleta (id_boleta, tipo, concepto, monto)
        values ($1, 'descuento', $2, $3)
        returning *
        `,
        [boleta.id_boleta, descuento.concepto, descuento.monto]
      );

      detalleCreado.push(detalleResult.rows[0]);
    }

    await client.query('commit');

    res.status(201).json({
      ok: true,
      msg: 'Boleta generada correctamente',
      funcionario,
      boleta,
      detalle: detalleCreado
    });

  } catch (error) {
    await client.query('rollback');

    res.status(500).json({
      ok: false,
      msg: 'Error al generar la boleta',
      error: error.message
    });

  } finally {
    client.release();
  }
};

const listarBoletas = async (req, res) => {
  try {
    const result = await pool.query(`
      select 
        b.id_boleta,
        b.id_funcionario,
        f.nombres || ' ' || f.apellidos as funcionario,
        f.ci,
        f.correo,
        a.nombre as area,
        c.nombre as cargo,
        b.mes,
        b.gestion,
        b.sueldo_basico,
        b.total_bonos,
        b.total_descuentos,
        b.total_pagado,
        b.fecha_pago,
        b.estado
      from boleta_pago b
      join funcionario f on b.id_funcionario = f.id_funcionario
      left join area a on f.id_area = a.id_area
      left join cargo c on f.id_cargo = c.id_cargo
      order by b.id_boleta desc
    `);

    res.json({
      ok: true,
      boletas: result.rows
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: 'Error al listar boletas',
      error: error.message
    });
  }
};

const obtenerBoletaPorId = async (req, res) => {
  try {
    const { id } = req.params;

    const boletaResult = await pool.query(
      `
      select 
        b.*,
        f.nombres,
        f.apellidos,
        f.ci,
        f.correo,
        f.telefono,
        f.direccion,
        f.fecha_ingreso,
        f.remuneracion,
        a.nombre as area,
        c.nombre as cargo
      from boleta_pago b
      join funcionario f on b.id_funcionario = f.id_funcionario
      left join area a on f.id_area = a.id_area
      left join cargo c on f.id_cargo = c.id_cargo
      where b.id_boleta = $1
      `,
      [id]
    );

    if (boletaResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        msg: 'Boleta no encontrada'
      });
    }

    const detalleResult = await pool.query(
      `
      select *
      from detalle_boleta
      where id_boleta = $1
      order by id_detalle asc
      `,
      [id]
    );

    res.json({
      ok: true,
      boleta: boletaResult.rows[0],
      detalle: detalleResult.rows
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: 'Error al obtener boleta',
      error: error.message
    });
  }
};

const obtenerBoletasPorFuncionario = async (req, res) => {
  try {
    const { idFuncionario } = req.params;

    const funcionarioResult = await pool.query(
      `
      select
        f.id_funcionario,
        f.nombres,
        f.apellidos,
        f.ci,
        f.correo,
        f.telefono,
        f.remuneracion,
        a.nombre as area,
        c.nombre as cargo
      from funcionario f
      left join area a on f.id_area = a.id_area
      left join cargo c on f.id_cargo = c.id_cargo
      where f.id_funcionario = $1
      `,
      [idFuncionario]
    );

    if (funcionarioResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        msg: 'Funcionario no encontrado'
      });
    }

    const boletasResult = await pool.query(
      `
      select *
      from boleta_pago
      where id_funcionario = $1
      order by gestion desc, mes desc
      `,
      [idFuncionario]
    );

    res.json({
      ok: true,
      funcionario: funcionarioResult.rows[0],
      boletas: boletasResult.rows
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: 'Error al obtener boletas del funcionario',
      error: error.message
    });
  }
};

const enviarBoletaCorreo = async (req, res) => {
  try {
    const { id } = req.params;

    const boletaResult = await pool.query(
      `
      select 
        b.*,
        f.nombres,
        f.apellidos,
        f.ci,
        f.correo,
        a.nombre as area,
        c.nombre as cargo
      from boleta_pago b
      join funcionario f on b.id_funcionario = f.id_funcionario
      left join area a on f.id_area = a.id_area
      left join cargo c on f.id_cargo = c.id_cargo
      where b.id_boleta = $1
      `,
      [id]
    );

    if (boletaResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        msg: 'Boleta no encontrada'
      });
    }

    const boleta = boletaResult.rows[0];

    if (!boleta.correo) {
      return res.status(400).json({
        ok: false,
        msg: 'El funcionario no tiene correo registrado'
      });
    }

    const detalleResult = await pool.query(
      `
      select *
      from detalle_boleta
      where id_boleta = $1
      order by id_detalle asc
      `,
      [id]
    );

    const detalle = detalleResult.rows;

    const bonos = detalle.filter(item => item.tipo === 'bono');
    const descuentos = detalle.filter(item => item.tipo === 'descuento');

    const filasBonos = bonos.map(item => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${item.concepto}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #047857; font-weight: 600;">
          ${formatearMonto(item.monto)}
        </td>
      </tr>
    `).join('');

    const filasDescuentos = descuentos.map(item => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${item.concepto}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #b91c1c; font-weight: 600;">
          - ${formatearMonto(item.monto)}
        </td>
      </tr>
    `).join('');

    const html = `
      <div style="margin:0; padding:0; background:#f3f4f6; font-family: Arial, sans-serif; color:#111827;">
        <div style="max-width: 720px; margin: 0 auto; padding: 28px 16px;">
          
          <div style="background:#111827; color:white; border-radius: 16px 16px 0 0; padding: 24px;">
            <h1 style="margin:0; font-size:24px;">ARCA LTDA.</h1>
            <p style="margin:6px 0 0; font-size:14px; color:#d1d5db;">Boleta de Pago Generada</p>
          </div>

          <div style="background:white; padding: 24px; border-radius: 0 0 16px 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.08);">
            
            <div style="display:flex; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:20px;">
              <div>
                <p style="margin:0; color:#6b7280; font-size:13px;">Funcionario</p>
                <h2 style="margin:4px 0 0; font-size:22px;">${boleta.nombres} ${boleta.apellidos}</h2>
              </div>
              <div style="text-align:right;">
                <p style="margin:0; color:#6b7280; font-size:13px;">Periodo</p>
                <h2 style="margin:4px 0 0; font-size:22px;">${obtenerMesTexto(boleta.mes)} ${boleta.gestion}</h2>
              </div>
            </div>

            <div style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:12px; padding:16px; margin-bottom:22px;">
              <table style="width:100%; border-collapse:collapse; font-size:14px;">
                <tr>
                  <td style="padding:6px 0; color:#6b7280;">CI:</td>
                  <td style="padding:6px 0; text-align:right; font-weight:600;">${boleta.ci}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0; color:#6b7280;">Área:</td>
                  <td style="padding:6px 0; text-align:right; font-weight:600;">${boleta.area || 'No asignada'}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0; color:#6b7280;">Cargo:</td>
                  <td style="padding:6px 0; text-align:right; font-weight:600;">${boleta.cargo || 'No asignado'}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0; color:#6b7280;">Fecha de pago:</td>
                  <td style="padding:6px 0; text-align:right; font-weight:600;">${boleta.fecha_pago}</td>
                </tr>
              </table>
            </div>

            <div style="margin-bottom:22px;">
              <h3 style="margin:0 0 10px; font-size:17px;">Resumen de pago</h3>
              <table style="width:100%; border-collapse:collapse; font-size:15px;">
                <tr>
                  <td style="padding:10px; border-bottom:1px solid #e5e7eb;">Sueldo básico</td>
                  <td style="padding:10px; border-bottom:1px solid #e5e7eb; text-align:right; font-weight:600;">
                    ${formatearMonto(boleta.sueldo_basico)}
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px; border-bottom:1px solid #e5e7eb;">Total bonos</td>
                  <td style="padding:10px; border-bottom:1px solid #e5e7eb; text-align:right; color:#047857; font-weight:600;">
                    ${formatearMonto(boleta.total_bonos)}
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px; border-bottom:1px solid #e5e7eb;">Total descuentos</td>
                  <td style="padding:10px; border-bottom:1px solid #e5e7eb; text-align:right; color:#b91c1c; font-weight:600;">
                    - ${formatearMonto(boleta.total_descuentos)}
                  </td>
                </tr>
              </table>
            </div>

            <div style="display:flex; gap:18px; flex-wrap:wrap; margin-bottom:22px;">
              <div style="flex:1; min-width:260px;">
                <h3 style="margin:0 0 10px; font-size:16px;">Bonos</h3>
                <table style="width:100%; border-collapse:collapse; background:#f9fafb; border-radius:12px; overflow:hidden; font-size:14px;">
                  ${filasBonos || '<tr><td style="padding:10px;">Sin bonos registrados</td></tr>'}
                </table>
              </div>

              <div style="flex:1; min-width:260px;">
                <h3 style="margin:0 0 10px; font-size:16px;">Descuentos</h3>
                <table style="width:100%; border-collapse:collapse; background:#f9fafb; border-radius:12px; overflow:hidden; font-size:14px;">
                  ${filasDescuentos || '<tr><td style="padding:10px;">Sin descuentos registrados</td></tr>'}
                </table>
              </div>
            </div>

            <div style="background:#111827; color:white; border-radius:14px; padding:20px; text-align:center;">
              <p style="margin:0; color:#d1d5db; font-size:14px;">Total pagado</p>
              <h2 style="margin:8px 0 0; font-size:30px;">${formatearMonto(boleta.total_pagado)}</h2>
            </div>

            <p style="margin:22px 0 0; color:#6b7280; font-size:13px; line-height:1.5;">
              Esta boleta fue generada automáticamente por el microservicio de pagos del sistema de Gestión Humana de ARCA LTDA.
            </p>
          </div>
        </div>
      </div>
    `;

    const response = await enviarCorreoBoleta({
      para: boleta.correo,
      asunto: `Boleta de pago - ${obtenerMesTexto(boleta.mes)} ${boleta.gestion}`,
      html
    });

    await pool.query(
      `
      update boleta_pago
      set estado = 'enviada'
      where id_boleta = $1
      `,
      [id]
    );

    res.json({
      ok: true,
      msg: 'Boleta enviada al correo del funcionario correctamente',
      correo: boleta.correo,
      boleta,
      detalle,
      response
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: 'Error al enviar la boleta por correo',
      error: error.message
    });
  }
};

const eliminarBoleta = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      delete from boleta_pago
      where id_boleta = $1
      returning *
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        msg: 'Boleta no encontrada'
      });
    }

    res.json({
      ok: true,
      msg: 'Boleta eliminada correctamente',
      boleta: result.rows[0]
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: 'Error al eliminar boleta',
      error: error.message
    });
  }
};

module.exports = {
  listarFuncionarios,
  crearBoleta,
  listarBoletas,
  obtenerBoletaPorId,
  obtenerBoletasPorFuncionario,
  enviarBoletaCorreo,
  eliminarBoleta
};