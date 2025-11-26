/**
 * Webhook WATI - Endpoint simples para integração com WATI
 * 
 * Este arquivo contém o código do endpoint que será usado pelo WATI
 * para consultar dados de zoneamento.
 * 
 * Endpoint: POST /webhook/zoneamento
 * Body: { "endereco": "..." }
 * Response: { "endereco_formatado": "...", "zoneamento": "...", "zoneamento_texto": "..." }
 */

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const axios = require('axios');

// 🔐 Variáveis de ambiente
const {
  DATABASE_URL,
  GOOGLE_API_KEY,
  PORT,
} = process.env;

// 🗄️ Conexão com Postgres
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// 🧩 Função para geocodificar um endereço
async function geocodeEndereco(endereco) {
  if (!GOOGLE_API_KEY) {
    throw new Error('GOOGLE_API_KEY não configurada');
  }

  const url =
    'https://maps.googleapis.com/maps/api/geocode/json?address=' +
    encodeURIComponent(endereco) +
    '&key=' +
    GOOGLE_API_KEY;

  const resp = await axios.get(url);
  if (resp.data.status !== 'OK' || !resp.data.results.length) {
    throw new Error('Não foi possível geocodificar o endereço');
  }

  const { formatted_address, geometry } = resp.data.results[0];
  const { lat, lng } = geometry.location;

  return {
    enderecoFormatado: formatted_address,
    lat,
    lng,
  };
}

// 🗺️ Função para consultar zoneamento usando PostGIS
async function consultarZoneamento(lat, lng) {
  const query = `
    SELECT zl_zona as codigo, zl_txt_zon as texto
    FROM zoneamento
    WHERE ST_Contains(geom, ST_SetSRID(ST_Point($1, $2), 31983))
    LIMIT 1
  `;

  try {
    const result = await pool.query(query, [lng, lat]);
    if (result.rows.length > 0) {
      return {
        codigo: result.rows[0].codigo,
        texto: result.rows[0].texto,
      };
    }
    return {
      codigo: 'Não identificado',
      texto: 'Zoneamento não encontrado',
    };
  } catch (error) {
    console.error('Erro ao consultar zoneamento:', error);
    throw error;
  }
}

// 🚀 Express app
const app = express();
app.use(cors());
app.use(express.json());

// ✅ Endpoint simples para WATI
app.post('/webhook/zoneamento', async (req, res) => {
  try {
    const { endereco } = req.body;

    if (!endereco || endereco.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Campo "endereco" é obrigatório',
      });
    }

    // 1) Geocodifica
    const { enderecoFormatado, lat, lng } = await geocodeEndereco(endereco);

    // 2) Consulta zoneamento
    const zoneamento = await consultarZoneamento(lat, lng);

    // 3) Retorna as variáveis WATI
    res.json({
      endereco_formatado: enderecoFormatado,
      zoneamento: zoneamento.codigo,
      zoneamento_texto: zoneamento.texto,
    });
  } catch (error) {
    console.error('Erro no webhook:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro ao processar endereço',
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Sobe o servidor
const porta = PORT || 3000;
app.listen(porta, () => {
  console.log(`🚀 Webhook WATI rodando na porta ${porta}`);
  console.log(`📍 Endpoint: POST /webhook/zoneamento`);
});
