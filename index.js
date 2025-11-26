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

// Rota POST para /zoneamento-endereco (compativel com o chatbot antigo do WATI)
app.post('/zoneamento-endereco', async (req, res) => {
  // Aceita tanto 'endereco' quanto 'endereco_imovel' (nomes que o WATI pode enviar)
  const endereco = req.body.endereco || req.body.endereco_imovel;

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

    // 3) Retorna com os NOMES DE VARIÁVEIS que o WATI espera mapear
    // IMPORTANTE: O WATI mapeia as chaves da resposta para as variáveis de contato
    res.json({
      // Variáveis que o WATI vai mapear (conforme configurado no webhook)
      end_fmt: enderecoFormatado,
      zon_cod: resultadoZoneamento.codigo || 'Nao identificado',
      zon_txt: resultadoZoneamento.texto || 'Zoneamento nao encontrado',
      
      // Dados adicionais para referência
      endereco_original: endereco,
      endereco_formatado: enderecoFormatado,
      lat,
      lng,
      zoneamento: resultadoZoneamento.codigo || 'Nao identificado',
      zoneamento_texto: resultadoZoneamento.texto || 'Zoneamento nao encontrado',
      mensagem_whatsapp: `Endereço: ${enderecoFormatado}\nZoneamento: ${resultadoZoneamento.codigo}`,
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

// Rota POST para /zoneamento-wati
app.post('/zoneamento-wati', async (req, res) => {
  // Aceita tanto 'endereco' quanto 'endereco_imovel' (nomes que o WATI pode enviar)
  const endereco = req.body.endereco || req.body.endereco_imovel;

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

    // 3) Retorna com os nomes de variaveis esperados pelo WATI
    res.json({
      endereco_formatado: enderecoFormatado,
      zoneamento: resultadoZoneamento.codigo || 'Nao identificado',
      zoneamento_texto: resultadoZoneamento.texto || 'Zoneamento nao encontrado',
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

// Rota POST para /zoneamento-wati-v2 (versao alternativa que aceita body JSON)
app.post('/zoneamento-wati-v2', async (req, res) => {
  const { endereco } = req.body;

  if (!endereco) {
    return res.status(400).json({
      success: false,
      error: 'O campo "endereco" eh obrigatorio.',
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
    console.error('Erro em /zoneamento-wati-v2 (POST):', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao processar o endereco.',
      details: error.message,
    });
  }
});

// Rota POST para /webhook/debug (para debugar o que está sendo recebido)
app.post('/webhook/debug', async (req, res) => {
  console.log('\n========== DEBUG WEBHOOK WATI ==========');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body completo:', JSON.stringify(req.body, null, 2));
  console.log('Query params:', JSON.stringify(req.query, null, 2));
  console.log('========================================\n');
  
  res.json({
    debug: true,
    timestamp: new Date().toISOString(),
    body_recebido: req.body,
    query_recebido: req.query,
    endereco_em_body: req.body.endereco || req.body.endereco_imovel || 'NAO ENCONTRADO',
    endereco_em_query: req.query.endereco || 'NAO ENCONTRADO',
    todas_as_chaves: Object.keys(req.body),
  });
});

// Rota GET para /webhook/debug-get (para debugar GET requests)
app.get('/webhook/debug-get', async (req, res) => {
  console.log('\n========== DEBUG WEBHOOK GET ==========');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Query params:', JSON.stringify(req.query, null, 2));
  console.log('========================================\n');
  
  res.json({
    debug: true,
    timestamp: new Date().toISOString(),
    query_recebido: req.query,
    endereco_em_query: req.query.endereco || 'NAO ENCONTRADO',
  });
});

// Rota GET para /webhook/zoneamento (aceita endereco como query parameter)
app.get('/webhook/zoneamento', async (req, res) => {
  try {
    const { endereco } = req.query;

    if (!endereco || endereco.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Parâmetro "endereco" eh obrigatorio',
      });
    }

    // 1) Geocodifica
    const { enderecoFormatado, lat, lng } = await geocodeEndereco(endereco);

    // 2) Consulta zoneamento
    const resultadoZoneamento = await consultarZoneamento(lat, lng);

    // 3) Retorna as variaveis WATI
    res.json({
      endereco_formatado: enderecoFormatado,
      zoneamento: resultadoZoneamento.codigo || 'Nao identificado',
      zoneamento_texto: resultadoZoneamento.texto || 'Zoneamento nao encontrado',
    });
  } catch (error) {
    console.error('Erro em GET /webhook/zoneamento:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro ao processar endereco',
    });
  }
});

// Rota POST para /webhook/zoneamento (novo endpoint simples para WATI)
app.post('/webhook/zoneamento', async (req, res) => {
  try {
    const { endereco } = req.body;

    if (!endereco || endereco.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Campo "endereco" eh obrigatorio',
      });
    }

    // 1) Geocodifica
    const { enderecoFormatado, lat, lng } = await geocodeEndereco(endereco);

    // 2) Consulta zoneamento
    const resultadoZoneamento = await consultarZoneamento(lat, lng);

    // 3) Retorna as variaveis WATI
    res.json({
      endereco_formatado: enderecoFormatado,
      zoneamento: resultadoZoneamento.codigo || 'Nao identificado',
      zoneamento_texto: resultadoZoneamento.texto || 'Zoneamento nao encontrado',
    });
  } catch (error) {
    console.error('Erro em /webhook/zoneamento:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro ao processar endereco',
    });
  }
});

// Rota POST para /webhook/zoneamento-wati (compatível com WATI - aceita variáveis)
app.post('/webhook/zoneamento-wati', async (req, res) => {
  try {
    // WATI pode enviar como 'endereco' ou 'endereco_imovel'
    const endereco = req.body.endereco || req.body.endereco_imovel;

    if (!endereco || endereco.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Campo "endereco" ou "endereco_imovel" eh obrigatorio',
      });
    }

    // 1) Geocodifica
    const { enderecoFormatado, lat, lng } = await geocodeEndereco(endereco);

    // 2) Consulta zoneamento
    const resultadoZoneamento = await consultarZoneamento(lat, lng);

    // 3) Retorna com os nomes de variáveis esperados pelo WATI
    res.json({
      endereco_formatado: enderecoFormatado,
      zoneamento: resultadoZoneamento.codigo || 'Nao identificado',
      zoneamento_texto: resultadoZoneamento.texto || 'Zoneamento nao encontrado',
    });
  } catch (error) {
    console.error('Erro em POST /webhook/zoneamento-wati:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro ao processar endereco',
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
  console.log(`   - POST /zoneamento-wati-v2 (endereco) - Versao alternativa com body JSON`);
  console.log(`   - POST /webhook/zoneamento (endereco) - Novo endpoint para WATI webhook`);
  console.log(`   - POST /webhook/zoneamento-wati (endereco) - Compativel com WATI (RECOMENDADO)`);
  console.log(`   - POST /webhook/debug - DEBUG: mostra o que WATI está enviando`);
  console.log(`   - GET  /webhook/debug-get - DEBUG: mostra query params`);
});
