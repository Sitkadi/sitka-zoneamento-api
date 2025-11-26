require('dotenv').config();
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

// 🧩 Função auxiliar para geocodificar um endereço usando Google Geocoding
async function geocodeEndereco(endereco) {
  if (!GOOGLE_API_KEY) {
    throw new Error(
      'GOOGLE_API_KEY não configurada no .env. Não é possível geocodificar.'
    );
  }

  const url =
    'https://maps.googleapis.com/maps/api/geocode/json?address=' +
    encodeURIComponent(endereco) +
    '&key=' +
    GOOGLE_API_KEY;

  const resp = await axios.get(url);
  if (resp.data.status !== 'OK' || !resp.data.results.length) {
    throw new Error(
      'Não foi possível geocodificar o endereço. Status: ' + resp.data.status
    );
  }

  const { formatted_address, geometry } = resp.data.results[0];
  const { lat, lng } = geometry.location;

  return {
    enderecoFormatado: formatted_address,
    lat,
    lng,
  };
}

// 🗺️ Função para consultar zoneamento por latitude/longitude
async function consultarZoneamento(lat, lng) {
  const client = await pool.connect();
  try {
    const query = `
      SELECT
        z.zl_zona AS cod_zoneamento,
        z.zl_txt_zon AS texto_zoneamento
      FROM zoneamento z
      WHERE ST_Contains(
        z.geom,
        ST_Transform(
          ST_SetSRID(ST_Point($1, $2), 4326),
          31983
        )
      )
      LIMIT 1;
    `;

    const values = [lng, lat]; // ordem: longitude, latitude
    const result = await client.query(query, values);

    if (result.rows.length === 0) {
      return {
        codigo: null,
        texto: 'Zoneamento não encontrado para esse ponto.',
      };
    }

    return {
      codigo: result.rows[0].cod_zoneamento,
      texto: result.rows[0].texto_zoneamento || 'Zoneamento não identificado.',
    };
  } finally {
    client.release();
  }
}

// 🚀 Configuração do Express
const app = express();
app.use(cors());
app.use(express.json());

// Rota raiz de healthcheck
app.get('/', (req, res) => {
  res
    .status(200)
    .json({ 
      success: true,
      message: 'API SITKA Zoneamento está no ar ✅',
      version: '1.0.0',
      endpoints: [
        'GET /health',
        'POST /zoneamento (lat, lng)',
        'POST /zoneamento-endereco (endereco)'
      ]
    });
});

// Rota de healthcheck
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'ok',
  });
});

// Rota para consultar zoneamento a partir de lat/lng
app.post('/zoneamento', async (req, res) => {
  const { lat, lng } = req.body;

  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({
      success: false,
      error: 'Parâmetros lat e lng são obrigatórios e devem ser numéricos.',
    });
  }

  try {
    const resultado = await consultarZoneamento(lat, lng);

    res.json({
      success: true,
      lat,
      lng,
      cod_zoneamento: resultado.codigo,
      txt_zoneamento: resultado.texto,
    });
  } catch (error) {
    console.error('Erro ao consultar zoneamento:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao consultar zoneamento.',
      details: error.message,
    });
  }
});

// Rota que recebe um endereço, geocodifica e retorna o zoneamento
app.post('/zoneamento-endereco', async (req, res) => {
  const { endereco } = req.body;

  if (!endereco) {
    return res.status(400).json({
      success: false,
      error: 'O campo "endereco" é obrigatório.',
    });
  }

  try {
    // 1) Geocodifica o endereço
    const { enderecoFormatado, lat, lng } = await geocodeEndereco(endereco);

    // 2) Consulta zoneamento
    const resultadoZoneamento = await consultarZoneamento(lat, lng);

    // 3) Responde para quem chamou
    res.json({
      success: true,
      endereco_original: endereco,
      endereco_formatado: enderecoFormatado,
      lat,
      lng,
      cod_zoneamento: resultadoZoneamento.codigo,
      txt_zoneamento: resultadoZoneamento.texto,
      // Variáveis para WATI (formato esperado pelo chatbot)
      end_fmt: enderecoFormatado,
      zon_cod: resultadoZoneamento.codigo,
      zon_txt: resultadoZoneamento.texto,
    });
  } catch (error) {
    console.error('Erro em /zoneamento-endereco:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao processar o endereço.',
      details: error.message,
    });
  }
});

// Rota alternativa que retorna APENAS as variáveis WATI (para webhooks simples)
app.post('/zoneamento-wati', async (req, res) => {
  const { endereco } = req.body;

  if (!endereco) {
    return res.status(400).json({
      success: false,
      error: 'O campo "endereco" é obrigatório.',
    });
  }

  try {
    // 1) Geocodifica o endereço
    const { enderecoFormatado, lat, lng } = await geocodeEndereco(endereco);

    // 2) Consulta zoneamento
    const resultadoZoneamento = await consultarZoneamento(lat, lng);

    // 3) Retorna APENAS as variáveis WATI
    res.json({
      end_fmt: enderecoFormatado,
      zon_cod: resultadoZoneamento.codigo || 'Não identificado',
      zon_txt: resultadoZoneamento.texto || 'Zoneamento não encontrado',
    });
  } catch (error) {
    console.error('Erro em /zoneamento-wati:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao processar o endereco.',
      details: error.message,
    });
  }
});

// Rota GET para /zoneamento-wati (para WATI que usa GET com query parameters)
app.get('/zoneamento-wati', async (req, res) => {
  const { endereco } = req.query;

  if (!endereco) {
    return res.status(400).json({
      success: false,
      error: 'O parametro "endereco" eh obrigatorio.',
    });
  }

  try {
    // 1) Geocodifica o endereco
    const { enderecoFormatado, lat, lng } = await geocodeEndereco(endereco);

    // 2) Consulta zoneamento
    const resultadoZoneamento = await consultarZoneamento(lat, lng);

    // 3) Retorna com os nomes de variaveis esperados pelo WATI
    res.json({
      endereco_formatado: enderecoFormatado,
      zoneamento: resultadoZoneamento.codigo || 'Nao identificado',
      zoneamento_texto: resultadoZoneamento.texto || 'Zoneamento nao encontrado',
    });
  } catch (error) {
    console.error('Erro em /zoneamento-wati (GET):', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao processar o endereco.',
      details: error.message,
    });
  }
});

// Sobe o servidor
const porta = PORT || 3000;
app.listen(porta, () => {
  console.log(`🚀 API Zoneamento rodando na porta ${porta}`);
  console.log(`📍 Endpoints disponíveis:`);
  console.log(`   - GET  /`);
  console.log(`   - GET  /health`);
  console.log(`   - POST /zoneamento (lat, lng)`);
  console.log(`   - POST /zoneamento-endereco (endereco)`);
  console.log(`   - POST /zoneamento-wati (endereco) - Retorna variaveis WATI`);
});
