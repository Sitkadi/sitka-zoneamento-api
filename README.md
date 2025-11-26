# Sitka Zoneamento API

API para consultar informações de zoneamento urbano por endereço ou coordenadas geográficas.

## Características

- ✅ Consulta zoneamento por latitude/longitude
- ✅ Geocodificação de endereços via Google Geocoding API
- ✅ Integração com banco de dados PostgreSQL + PostGIS
- ✅ CORS habilitado para integração com frontend
- ✅ Docker ready para deploy no Render

## Endpoints

### 1. GET `/`
Retorna informações gerais da API.

**Resposta**:
```json
{
  "success": true,
  "message": "API SITKA Zoneamento está no ar ✅",
  "version": "1.0.0",
  "endpoints": [
    "GET /health",
    "POST /zoneamento (lat, lng)",
    "POST /zoneamento-endereco (endereco)"
  ]
}
```

### 2. GET `/health`
Healthcheck simples.

**Resposta**:
```json
{
  "success": true,
  "message": "ok"
}
```

### 3. POST `/zoneamento`
Consulta zoneamento por latitude e longitude.

**Body**:
```json
{
  "lat": -23.5614117,
  "lng": -46.6558999
}
```

**Resposta de sucesso**:
```json
{
  "success": true,
  "lat": -23.5614117,
  "lng": -46.6558999,
  "cod_zoneamento": "ZEU",
  "txt_zoneamento": "Zona Eixo de Estruturação da Transformação Urbana"
}
```

### 4. POST `/zoneamento-endereco`
Geocodifica um endereço e retorna o zoneamento.

**Body**:
```json
{
  "endereco": "Av. Paulista, 1578, São Paulo"
}
```

**Resposta de sucesso**:
```json
{
  "success": true,
  "endereco_original": "Av. Paulista, 1578, São Paulo",
  "endereco_formatado": "Av. Paulista, 1578 - Bela Vista, São Paulo - SP, 01310-200, Brasil",
  "lat": -23.5614117,
  "lng": -46.6558999,
  "cod_zoneamento": "ZEU",
  "txt_zoneamento": "Zona Eixo de Estruturação da Transformação Urbana"
}
```

## Variáveis de Ambiente

```env
# Banco de dados PostgreSQL com PostGIS
DATABASE_URL=postgresql://user:password@host:5432/database

# Google Geocoding API
GOOGLE_API_KEY=your_google_api_key

# Porta do servidor
PORT=3000
```

## Instalação Local

```bash
# Instalar dependências
npm install

# Copiar arquivo de exemplo
cp .env.example .env

# Editar .env com suas credenciais
nano .env

# Iniciar servidor
npm start
```

## Deploy no Render

1. Criar repositório GitHub com este código
2. Conectar ao Render
3. Configurar variáveis de ambiente:
   - `DATABASE_URL`
   - `GOOGLE_API_KEY`
4. Deploy automático via GitHub

## Estrutura do Banco de Dados

A API espera uma tabela `zoneamento` com a seguinte estrutura:

```sql
CREATE TABLE zoneamento (
  id SERIAL PRIMARY KEY,
  geom GEOMETRY(MultiPolygon, 31983),
  zl_zona VARCHAR(15),
  zl_txt_zon VARCHAR(254),
  -- outras colunas...
);

CREATE INDEX sidx_zoneamento_geom ON zoneamento USING GIST(geom);
```

## Códigos de Zoneamento Suportados

- **ZC**: Zona de Centralidade
- **ZEU**: Zona Eixo de Estruturação da Transformação Urbana
- **ZEM**: Zona Eixo de Estruturação da Transformação Metropolitana
- **ZER**: Zona Exclusivamente Residencial
- **ZM**: Zona Mista
- **ZMa**: Zona Mista Ambiental
- **ZPI**: Zona Predominantemente Industrial
- **ZEIS**: Zona Especial de Interesse Social
- **ZEPAM**: Zona Especial de Proteção Ambiental
- **ZEP**: Zona Especial de Preservação

## Tecnologias

- **Node.js** 22
- **Express** 5.x
- **PostgreSQL** 18 com PostGIS
- **Google Geocoding API**
- **Docker**

## Licença

ISC
