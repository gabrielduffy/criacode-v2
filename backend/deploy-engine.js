const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const { promisify } = require('util');
const execPromise = promisify(exec);

class DeployEngine {
  constructor(pool, io) {
    this.pool = pool;
    this.io = io;
    this.deploysDir = '/var/criacode/deploys';
    this.nginxConfigDir = '/etc/nginx/sites-available';
    this.nginxEnabledDir = '/etc/nginx/sites-enabled';
  }

  // Criar diretório de deploy para o projeto
  async createDeployDirectory(projectId) {
    const projectDir = path.join(this.deploysDir, `project-${projectId}`);
    await fs.mkdir(projectDir, { recursive: true });
    return projectDir;
  }

  // Salvar arquivos do projeto no disco
  async saveProjectFiles(projectId, files) {
    const projectDir = await this.createDeployDirectory(projectId);
    
    for (const file of files) {
      const filePath = path.join(projectDir, file.path);
      const fileDir = path.dirname(filePath);
      
      await fs.mkdir(fileDir, { recursive: true });
      await fs.writeFile(filePath, file.content || '');
    }
    
    return projectDir;
  }

  // Adicionar log de build
  async addBuildLog(deploymentId, logType, message) {
    await this.pool.query(
      'INSERT INTO build_logs (deployment_id, log_type, message) VALUES ($1, $2, $3)',
      [deploymentId, logType, message]
    );
    
    // Emitir via WebSocket
    this.io.to(`deployment-${deploymentId}`).emit('build-log', {
      type: logType,
      message,
      timestamp: new Date()
    });
  }

  // Build do projeto React/Vite
  async buildReactProject(projectDir, deploymentId, project) {
    try {
      await this.addBuildLog(deploymentId, 'info', '📦 Instalando dependências...');
      
      // Instalar dependências
      const { stdout: installOut } = await execPromise('npm install', { 
        cwd: projectDir,
        timeout: 300000 // 5 minutos
      });
      await this.addBuildLog(deploymentId, 'info', installOut);

      await this.addBuildLog(deploymentId, 'info', '🔨 Construindo projeto...');
      
      // Build
      const buildCommand = project.build_command || 'npm run build';
      const { stdout: buildOut } = await execPromise(buildCommand, { 
        cwd: projectDir,
        timeout: 600000 // 10 minutos
      });
      await this.addBuildLog(deploymentId, 'info', buildOut);

      return true;
    } catch (error) {
      await this.addBuildLog(deploymentId, 'error', `❌ Erro no build: ${error.message}`);
      throw error;
    }
  }

  // Build do projeto Next.js
  async buildNextProject(projectDir, deploymentId, project) {
    try {
      await this.addBuildLog(deploymentId, 'info', '📦 Instalando dependências Next.js...');
      
      const { stdout: installOut } = await execPromise('npm install', { 
        cwd: projectDir,
        timeout: 300000
      });
      await this.addBuildLog(deploymentId, 'info', installOut);

      await this.addBuildLog(deploymentId, 'info', '🔨 Construindo Next.js...');
      
      const { stdout: buildOut } = await execPromise('npm run build', { 
        cwd: projectDir,
        timeout: 600000
      });
      await this.addBuildLog(deploymentId, 'info', buildOut);

      return true;
    } catch (error) {
      await this.addBuildLog(deploymentId, 'error', `❌ Erro no build: ${error.message}`);
      throw error;
    }
  }

  // Criar Dockerfile dinâmico
  async createDockerfile(projectDir, project) {
    let dockerfile = '';

    if (project.framework === 'react' || project.framework === 'html') {
      // Dockerfile para SPA (React, HTML estático)
      dockerfile = `
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN ${project.build_command || 'npm run build'}

FROM nginx:alpine
COPY --from=builder /app/${project.output_dir || 'dist'} /usr/share/nginx/html
COPY nginx-spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
      `;

      // Criar config do nginx para SPA
      const nginxSpaConfig = `
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
}
      `;
      
      await fs.writeFile(path.join(projectDir, 'nginx-spa.conf'), nginxSpaConfig);

    } else if (project.framework === 'nextjs') {
      // Dockerfile para Next.js
      dockerfile = `
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE ${project.port || 3000}
CMD ["npm", "start"]
      `;

    } else if (project.framework === 'node') {
      // Dockerfile para Node.js API
      dockerfile = `
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE ${project.port || 3000}
CMD ["${project.start_command || 'node index.js'}"]
      `;
    }

    await fs.writeFile(path.join(projectDir, 'Dockerfile'), dockerfile);
  }

  // Criar e iniciar container Docker
  async createContainer(projectId, deploymentId, project, projectDir) {
    const containerName = `criacode-project-${projectId}-${Date.now()}`;
    const port = project.port || 3000;
    const hostPort = 10000 + projectId; // Porta única por projeto

    try {
      await this.addBuildLog(deploymentId, 'info', '🐳 Criando container Docker...');

      // Criar Dockerfile
      await this.createDockerfile(projectDir, project);

      // Build da imagem Docker
      await this.addBuildLog(deploymentId, 'info', '🔨 Construindo imagem Docker...');
      const imageName = `criacode-${projectId}:latest`;
      
      await execPromise(`docker build -t ${imageName} .`, {
        cwd: projectDir,
        timeout: 900000 // 15 minutos
      });

      // Parar container anterior se existir
      try {
        const { rows: oldDeployments } = await this.pool.query(
          'SELECT container_name FROM deployments WHERE project_id = $1 AND status = $2 AND id != $3',
          [projectId, 'running', deploymentId]
        );

        for (const deploy of oldDeployments) {
          if (deploy.container_name) {
            await execPromise(`docker stop ${deploy.container_name}`);
            await execPromise(`docker rm ${deploy.container_name}`);
          }
        }
      } catch (err) {
        console.log('Nenhum container anterior para parar');
      }

      // Iniciar novo container
      await this.addBuildLog(deploymentId, 'info', '🚀 Iniciando container...');
      
      const { stdout } = await execPromise(
        `docker run -d --name ${containerName} -p ${hostPort}:${port} --restart unless-stopped ${imageName}`
      );

      const containerId = stdout.trim();

      await this.addBuildLog(deploymentId, 'info', `✅ Container criado: ${containerName}`);

      return {
        containerId,
        containerName,
        hostPort
      };

    } catch (error) {
      await this.addBuildLog(deploymentId, 'error', `❌ Erro ao criar container: ${error.message}`);
      throw error;
    }
  }

  // Configurar Nginx como proxy reverso
  async configureNginx(projectId, hostPort, domain = null) {
    const serverName = domain || `project-${projectId}.local`;
    const configFile = `criacode-project-${projectId}`;
    
    const nginxConfig = `
server {
    listen 80;
    server_name ${serverName};

    location / {
        proxy_pass http://localhost:${hostPort};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
    `;

    try {
      const configPath = path.join(this.nginxConfigDir, configFile);
      await fs.writeFile(configPath, nginxConfig);

      // Criar link simbólico
      const enabledPath = path.join(this.nginxEnabledDir, configFile);
      try {
        await fs.unlink(enabledPath);
      } catch (err) {
        // Arquivo não existe, tudo bem
      }
      await fs.symlink(configPath, enabledPath);

      // Testar e recarregar nginx
      await execPromise('nginx -t');
      await execPromise('nginx -s reload');

      return serverName;
    } catch (error) {
      console.error('Erro ao configurar Nginx:', error);
      throw error;
    }
  }

  // Deploy completo
  async deploy(projectId, userId, commitMessage = 'Deploy manual') {
    const startTime = Date.now();
    
    try {
      // Buscar dados do projeto
      const { rows: [project] } = await this.pool.query(
        'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
        [projectId, userId]
      );

      if (!project) {
        throw new Error('Projeto não encontrado');
      }

      // Criar registro de deployment
      const { rows: [deployment] } = await this.pool.query(
        `INSERT INTO deployments (project_id, status, commit_message) 
         VALUES ($1, $2, $3) RETURNING id`,
        [projectId, 'building', commitMessage]
      );

      const deploymentId = deployment.id;

      await this.addBuildLog(deploymentId, 'info', '🚀 Iniciando deploy...');

      // Buscar arquivos do projeto
      const { rows: files } = await this.pool.query(
        'SELECT * FROM files WHERE project_id = $1',
        [projectId]
      );

      if (files.length === 0) {
        throw new Error('Projeto não tem arquivos');
      }

      // Salvar arquivos no disco
      await this.addBuildLog(deploymentId, 'info', '📁 Salvando arquivos...');
      const projectDir = await this.saveProjectFiles(projectId, files);

      // Build baseado no framework
      if (project.framework === 'react' || project.framework === 'html') {
        await this.buildReactProject(projectDir, deploymentId, project);
      } else if (project.framework === 'nextjs') {
        await this.buildNextProject(projectDir, deploymentId, project);
      }

      // Criar e iniciar container
      const { containerId, containerName, hostPort } = await this.createContainer(
        projectId, 
        deploymentId, 
        project, 
        projectDir
      );

      // Configurar Nginx
      await this.addBuildLog(deploymentId, 'info', '⚙️ Configurando proxy reverso...');
      const serverName = await this.configureNginx(projectId, hostPort);

      // Calcular duração do build
      const buildDuration = Math.floor((Date.now() - startTime) / 1000);

      // Atualizar deployment
      const url = `http://${serverName}`;
      await this.pool.query(
        `UPDATE deployments 
         SET status = $1, container_id = $2, container_name = $3, url = $4, build_duration = $5, updated_at = CURRENT_TIMESTAMP
         WHERE id = $6`,
        ['running', containerId, containerName, url, buildDuration, deploymentId]
      );

      // Atualizar deploys antigos para 'stopped'
      await this.pool.query(
        'UPDATE deployments SET status = $1 WHERE project_id = $2 AND id != $3 AND status = $4',
        ['stopped', projectId, deploymentId, 'running']
      );

      await this.addBuildLog(deploymentId, 'info', `✅ Deploy concluído com sucesso em ${buildDuration}s!`);
      await this.addBuildLog(deploymentId, 'info', `🌐 URL: ${url}`);

      return {
        success: true,
        deploymentId,
        url,
        buildDuration
      };

    } catch (error) {
      console.error('Erro no deploy:', error);
      
      // Atualizar status para failed
      await this.pool.query(
        'UPDATE deployments SET status = $1 WHERE id = $2',
        ['failed', deployment?.id]
      );

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Parar deployment
  async stopDeployment(deploymentId) {
    try {
      const { rows: [deployment] } = await this.pool.query(
        'SELECT * FROM deployments WHERE id = $1',
        [deploymentId]
      );

      if (deployment && deployment.container_name) {
        await execPromise(`docker stop ${deployment.container_name}`);
        await execPromise(`docker rm ${deployment.container_name}`);

        await this.pool.query(
          'UPDATE deployments SET status = $1 WHERE id = $2',
          ['stopped', deploymentId]
        );
      }

      return true;
    } catch (error) {
      console.error('Erro ao parar deployment:', error);
      return false;
    }
  }
}

module.exports = DeployEngine;