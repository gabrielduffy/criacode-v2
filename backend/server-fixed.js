const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const Anthropic = require('@anthropic-ai/sdk');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { createServer } = require('http');
const { Server } = require('socket.io');
const DeployEngine = require('./deploy-engine');
require('dotenv').config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));

// PostgreSQL
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
});

pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Erro ao conectar no PostgreSQL:', err);
  } else {
    console.log('✅ Conectado ao PostgreSQL:', res.rows[0].now);
  }
});

// Claude API
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Deploy Engine
const deployEngine = new DeployEngine(pool, io);

// Middleware de autenticação
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'criacode-secret-key', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido' });
    }
    req.user = user;
    next();
  });
};

// ============================================
// ROTAS DE AUTENTICAÇÃO
// ============================================

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET || 'criacode-secret-key',
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro ao fazer login' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  const { email, password, name } = req.body;

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name',
      [email, passwordHash, name]
    );

    const user = result.rows[0];
    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET || 'criacode-secret-key',
      { expiresIn: '7d' }
    );

    res.json({ token, user });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Email já cadastrado' });
    }
    console.error('Erro no registro:', error);
    res.status(500).json({ error: 'Erro ao criar conta' });
  }
});

// ============================================
// ROTAS DE PROJETOS
// ============================================

app.post('/api/projects', authenticateToken, async (req, res) => {
  const { name, description, framework, buildCommand, startCommand, outputDir, port } = req.body;
  
  try {
    const result = await pool.query(
      `INSERT INTO projects (user_id, name, description, framework, build_command, start_command, output_dir, port) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.user.id, name, description || '', framework || 'react', buildCommand, startCommand, outputDir, port]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao buscar projeto:', error);
    res.status(500).json({ error: 'Erro ao buscar projeto' });
  }
});

app.get('/api/projects', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM projects WHERE user_id = $1 ORDER BY updated_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao listar projetos:', error);
    res.status(500).json({ error: 'Erro ao listar projetos' });
  }
});

app.get('/api/projects/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Projeto não encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao buscar projeto:', error);
    res.status(500).json({ error: 'Erro ao buscar projeto' });
  }
});

app.put('/api/projects/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name, description, framework, buildCommand, startCommand, outputDir, port } = req.body;
  
  try {
    const result = await pool.query(
      `UPDATE projects 
       SET name = $1, description = $2, framework = $3, build_command = $4, 
           start_command = $5, output_dir = $6, port = $7, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $8 AND user_id = $9 RETURNING *`,
      [name, description, framework, buildCommand, startCommand, outputDir, port, id, req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Projeto não encontrado' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar projeto:', error);
    res.status(500).json({ error: 'Erro ao atualizar projeto' });
  }
});

app.delete('/api/projects/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await pool.query(
      'DELETE FROM projects WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Projeto não encontrado' });
    }
    
    res.json({ message: 'Projeto deletado com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar projeto:', error);
    res.status(500).json({ error: 'Erro ao deletar projeto' });
  }
});

// ============================================
// ROTAS DE ARQUIVOS
// ============================================

app.post('/api/files', authenticateToken, async (req, res) => {
  const { projectId, name, path, content, fileType } = req.body;
  
  try {
    const projectCheck = await pool.query(
      'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
      [projectId, req.user.id]
    );
    
    if (projectCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    
    const result = await pool.query(
      'INSERT INTO files (project_id, name, path, content, file_type) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [projectId, name, path, content || '', fileType]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Arquivo já existe neste caminho' });
    }
    console.error('Erro ao criar arquivo:', error);
    res.status(500).json({ error: 'Erro ao criar arquivo' });
  }
});

app.get('/api/files/project/:projectId', authenticateToken, async (req, res) => {
  const { projectId } = req.params;
  
  try {
    const projectCheck = await pool.query(
      'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
      [projectId, req.user.id]
    );
    
    if (projectCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    
    const result = await pool.query(
      'SELECT * FROM files WHERE project_id = $1 ORDER BY path',
      [projectId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao listar arquivos:', error);
    res.status(500).json({ error: 'Erro ao listar arquivos' });
  }
});

app.get('/api/files/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await pool.query(
      `SELECT f.* FROM files f
       JOIN projects p ON f.project_id = p.id
       WHERE f.id = $1 AND p.user_id = $2`,
      [id, req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Arquivo não encontrado' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao buscar arquivo:', error);
    res.status(500).json({ error: 'Erro ao buscar arquivo' });
  }
});

app.put('/api/files/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { content, name } = req.body;
  
  try {
    const currentFile = await pool.query(
      `SELECT f.* FROM files f
       JOIN projects p ON f.project_id = p.id
       WHERE f.id = $1 AND p.user_id = $2`,
      [id, req.user.id]
    );
    
    if (currentFile.rows.length === 0) {
      return res.status(404).json({ error: 'Arquivo não encontrado' });
    }
    
    const versionCount = await pool.query(
      'SELECT COALESCE(MAX(version_number), 0) as max_version FROM file_versions WHERE file_id = $1',
      [id]
    );
    
    await pool.query(
      'INSERT INTO file_versions (file_id, content, version_number) VALUES ($1, $2, $3)',
      [id, currentFile.rows[0].content, versionCount.rows[0].max_version + 1]
    );
    
    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;
    
    if (content !== undefined) {
      updateFields.push(`content = $${paramCount++}`);
      updateValues.push(content);
    }
    
    if (name !== undefined) {
      updateFields.push(`name = $${paramCount++}`);
      updateValues.push(name);
    }
    
    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    updateValues.push(id);
    
    const result = await pool.query(
      `UPDATE files SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      updateValues
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar arquivo:', error);
    res.status(500).json({ error: 'Erro ao atualizar arquivo' });
  }
});

app.delete('/api/files/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await pool.query(
      `DELETE FROM files f
       USING projects p
       WHERE f.project_id = p.id AND f.id = $1 AND p.user_id = $2
       RETURNING f.*`,
      [id, req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Arquivo não encontrado' });
    }
    
    res.json({ message: 'Arquivo deletado com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar arquivo:', error);
    res.status(500).json({ error: 'Erro ao deletar arquivo' });
  }
});

// ============================================
// ROTAS DE DEPLOY
// ============================================

// Iniciar deploy
app.post('/api/deploy/:projectId', authenticateToken, async (req, res) => {
  const { projectId } = req.params;
  const { commitMessage } = req.body;
  
  try {
    // Verificar se projeto pertence ao usuário
    const projectCheck = await pool.query(
      'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
      [projectId, req.user.id]
    );
    
    if (projectCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    // Iniciar deploy (assíncrono)
    deployEngine.deploy(projectId, req.user.id, commitMessage || 'Deploy manual')
      .then(result => {
        io.to(`project-${projectId}`).emit('deploy-complete', result);
      })
      .catch(error => {
        console.error('Erro no deploy:', error);
      });

    res.json({ 
      message: 'Deploy iniciado',
      status: 'building'
    });

  } catch (error) {
    console.error('Erro ao iniciar deploy:', error);
    res.status(500).json({ error: 'Erro ao iniciar deploy' });
  }
});

// Listar deploys do projeto
app.get('/api/deploys/:projectId', authenticateToken, async (req, res) => {
  const { projectId } = req.params;
  
  try {
    const projectCheck = await pool.query(
      'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
      [projectId, req.user.id]
    );
    
    if (projectCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const result = await pool.query(
      'SELECT * FROM deployments WHERE project_id = $1 ORDER BY created_at DESC LIMIT 20',
      [projectId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao listar deploys:', error);
    res.status(500).json({ error: 'Erro ao listar deploys' });
  }
});

// Buscar logs de um deploy
app.get('/api/deploy/:deployId/logs', authenticateToken, async (req, res) => {
  const { deployId } = req.params;
  
  try {
    const deployCheck = await pool.query(
      `SELECT d.* FROM deployments d
       JOIN projects p ON d.project_id = p.id
       WHERE d.id = $1 AND p.user_id = $2`,
      [deployId, req.user.id]
    );
    
    if (deployCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const result = await pool.query(
      'SELECT * FROM build_logs WHERE deployment_id = $1 ORDER BY created_at',
      [deployId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar logs:', error);
    res.status(500).json({ error: 'Erro ao buscar logs' });
  }
});

// Parar deployment
app.post('/api/deploy/:deployId/stop', authenticateToken, async (req, res) => {
  const { deployId } = req.params;
  
  try {
    const deployCheck = await pool.query(
      `SELECT d.* FROM deployments d
       JOIN projects p ON d.project_id = p.id
       WHERE d.id = $1 AND p.user_id = $2`,
      [deployId, req.user.id]
    );
    
    if (deployCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const result = await deployEngine.stopDeployment(deployId);
    
    res.json({ success: result });
  } catch (error) {
    console.error('Erro ao parar deploy:', error);
    res.status(500).json({ error: 'Erro ao parar deploy' });
  }
});

// ============================================
// ROTAS DE DOMÍNIOS
// ============================================

// Adicionar domínio customizado
app.post('/api/domains', authenticateToken, async (req, res) => {
  const { projectId, domain } = req.body;
  
  try {
    const projectCheck = await pool.query(
      'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
      [projectId, req.user.id]
    );
    
    if (projectCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const result = await pool.query(
      'INSERT INTO domains (project_id, domain) VALUES ($1, $2) RETURNING *',
      [projectId, domain]
    );
    
    // TODO: Configurar Nginx para o novo domínio
    // TODO: Obter certificado SSL (Let's Encrypt)
    
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Domínio já está em uso' });
    }
    console.error('Erro ao adicionar domínio:', error);
    res.status(500).json({ error: 'Erro ao adicionar domínio' });
  }
});

// Listar domínios do projeto
app.get('/api/domains/:projectId', authenticateToken, async (req, res) => {
  const { projectId } = req.params;
  
  try {
    const projectCheck = await pool.query(
      'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
      [projectId, req.user.id]
    );
    
    if (projectCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const result = await pool.query(
      'SELECT * FROM domains WHERE project_id = $1 ORDER BY created_at DESC',
      [projectId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao listar domínios:', error);
    res.status(500).json({ error: 'Erro ao listar domínios' });
  }
});

// Deletar domínio
app.delete('/api/domains/:domainId', authenticateToken, async (req, res) => {
  const { domainId } = req.params;
  
  try {
    const result = await pool.query(
      `DELETE FROM domains d
       USING projects p
       WHERE d.project_id = p.id AND d.id = $1 AND p.user_id = $2
       RETURNING d.*`,
      [domainId, req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Domínio não encontrado' });
    }
    
    res.json({ message: 'Domínio removido com sucesso' });
  } catch (error) {
    console.error('Erro ao remover domínio:', error);
    res.status(500).json({ error: 'Erro ao remover domínio' });
  }
});

// ============================================
// ROTAS DE CONVERSAS E CHAT COM IA
// ============================================

app.post('/api/conversations', authenticateToken, async (req, res) => {
  const { projectId, title } = req.body;
  
  try {
    const projectCheck = await pool.query(
      'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
      [projectId, req.user.id]
    );
    
    if (projectCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    
    const result = await pool.query(
      'INSERT INTO conversations (project_id, title) VALUES ($1, $2) RETURNING *',
      [projectId, title || 'Nova Conversa']
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar conversa:', error);
    res.status(500).json({ error: 'Erro ao criar conversa' });
  }
});

app.get('/api/conversations/project/:projectId', authenticateToken, async (req, res) => {
  const { projectId } = req.params;
  
  try {
    const projectCheck = await pool.query(
      'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
      [projectId, req.user.id]
    );
    
    if (projectCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    
    const result = await pool.query(
      'SELECT * FROM conversations WHERE project_id = $1 ORDER BY created_at DESC',
      [projectId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao listar conversas:', error);
    res.status(500).json({ error: 'Erro ao listar conversas' });
  }
});

app.get('/api/messages/:conversationId', authenticateToken, async (req, res) => {
  const { conversationId } = req.params;
  
  try {
    const convCheck = await pool.query(
      `SELECT c.* FROM conversations c
       JOIN projects p ON c.project_id = p.id
       WHERE c.id = $1 AND p.user_id = $2`,
      [conversationId, req.user.id]
    );
    
    if (convCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    
    const result = await pool.query(
      'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at',
      [conversationId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar mensagens:', error);
    res.status(500).json({ error: 'Erro ao buscar mensagens' });
  }
});

app.post('/api/chat', authenticateToken, async (req, res) => {
  const { conversationId, projectId, message } = req.body;
  
  try {
    const projectCheck = await pool.query(
      'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
      [projectId, req.user.id]
    );
    
    if (projectCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    
    await pool.query(
      'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)',
      [conversationId, 'user', message]
    );
    
    const files = await pool.query(
      'SELECT name, path, content, file_type FROM files WHERE project_id = $1',
      [projectId]
    );
    
    let projectContext = '';
    if (files.rows.length > 0) {
      projectContext = 'Arquivos do projeto:\n\n';
      files.rows.forEach(f => {
        projectContext += `--- ${f.path} (${f.file_type}) ---\n${f.content}\n\n`;
      });
    }
    
    const history = await pool.query(
      'SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at',
      [conversationId]
    );
    
    const messages = history.rows.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
    
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 8000,
      system: `Você é o assistente de IA do CriaCode, uma plataforma de desenvolvimento web.

Seu trabalho é ajudar o usuário a criar e modificar aplicações React modernas.

Contexto do projeto atual:
${projectContext}

Quando o usuário pedir para criar ou modificar componentes:
- Gere código React funcional e completo
- Use Tailwind CSS para estilização
- Siga as melhores práticas do React
- Seja claro e direto nas explicações
- Sempre forneça código completo, não apenas snippets

Responda em português do Brasil (pt-BR).`,
      messages: messages
    });
    
    const aiMessage = response.content[0].text;
    
    await pool.query(
      'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)',
      [conversationId, 'assistant', aiMessage]
    );
    
    res.json({ 
      message: aiMessage,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens
      }
    });
  } catch (error) {
    console.error('Erro no chat:', error);
    res.status(500).json({ error: 'Erro ao processar mensagem' });
  }
});

// ============================================
// WEBSOCKET PARA UPDATES EM TEMPO REAL
// ============================================

io.on('connection', (socket) => {
  console.log('✅ Cliente conectado:', socket.id);
  
  socket.on('join-project', (projectId) => {
    socket.join(`project-${projectId}`);
    console.log(`Socket ${socket.id} entrou no projeto ${projectId}`);
  });
  
  socket.on('join-deployment', (deploymentId) => {
    socket.join(`deployment-${deploymentId}`);
    console.log(`Socket ${socket.id} entrou no deployment ${deploymentId}`);
  });
  
  socket.on('file-update', (data) => {
    socket.to(`project-${data.projectId}`).emit('file-changed', data);
  });
  
  socket.on('disconnect', () => {
    console.log('❌ Cliente desconectado:', socket.id);
  });
});

// ============================================
// ROTA DE HEALTH CHECK
// ============================================

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'CriaCode Backend v2.0',
    features: ['deploy', 'docker', 'domains'],
    timestamp: new Date().toISOString()
  });
});

// ============================================
// INICIAR SERVIDOR
// ============================================

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════╗
║                                       ║
║   🚀 CRIACODE V2 BACKEND ONLINE!     ║
║                                       ║
║   📡 Servidor: http://0.0.0.0:${PORT}   ║
║   🗄️  PostgreSQL: Conectado           ║
║   🤖 Claude API: Configurado          ║
║   🐳 Docker: Deploy Engine Ready      ║
║                                       ║
╚═══════════════════════════════════════╝
  `);
});
