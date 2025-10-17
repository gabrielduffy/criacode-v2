import { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import axios from 'axios';
import { io } from 'socket.io-client';
import Split from 'react-split';
import { 
  Send, 
  Plus, 
  Save, 
  FileCode, 
  MessageSquare,
  FolderOpen,
  Rocket,
  LogOut,
  Trash2,
  Globe,
  ExternalLink,
  Clock,
  CheckCircle,
  XCircle,
  Loader,
  Settings
} from 'lucide-react';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [currentProject, setCurrentProject] = useState(null);
  const [files, setFiles] = useState([]);
  const [currentFile, setCurrentFile] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [loading, setLoading] = useState(false);
  
  // Deploy states
  const [deployments, setDeployments] = useState([]);
  const [showDeployPanel, setShowDeployPanel] = useState(false);
  const [deployLogs, setDeployLogs] = useState([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [domains, setDomains] = useState([]);
  const [showDomainModal, setShowDomainModal] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  
  // Login
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [socket, setSocket] = useState(null);

  const axiosConfig = {
    headers: { Authorization: `Bearer ${token}` }
  };

  useEffect(() => {
    if (token) {
      loadProjects();
      
      // Conectar WebSocket
      const newSocket = io(API_URL);
      setSocket(newSocket);
      
      return () => newSocket.close();
    }
  }, [token]);

  useEffect(() => {
    if (currentProject) {
      loadFiles();
      loadConversations();
      loadDeployments();
      loadDomains();
      
      if (socket) {
        socket.emit('join-project', currentProject.id);
      }
    }
  }, [currentProject, socket]);

  useEffect(() => {
    if (currentConversation) {
      loadMessages();
    }
  }, [currentConversation]);

  // WebSocket listeners
  useEffect(() => {
    if (socket && currentProject) {
      socket.on('build-log', (log) => {
        setDeployLogs(prev => [...prev, log]);
      });

      socket.on('deploy-complete', (result) => {
        setIsDeploying(false);
        loadDeployments();
        if (result.success) {
          alert(`Deploy concluído! URL: ${result.url}`);
        } else {
          alert(`Erro no deploy: ${result.error}`);
        }
      });

      return () => {
        socket.off('build-log');
        socket.off('deploy-complete');
      };
    }
  }, [socket, currentProject]);

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const response = await axios.post(`${API_URL}/api/auth/login`, {
        email: loginEmail,
        password: loginPassword
      });
      setToken(response.data.token);
      setUser(response.data.user);
      localStorage.setItem('token', response.data.token);
    } catch (error) {
      alert('Erro ao fazer login: ' + (error.response?.data?.error || 'Erro desconhecido'));
    }
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('token');
    setProjects([]);
    setCurrentProject(null);
    if (socket) socket.close();
  };

  const loadProjects = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/projects`, axiosConfig);
      setProjects(response.data);
      if (response.data.length > 0 && !currentProject) {
        setCurrentProject(response.data[0]);
      }
    } catch (error) {
      console.error('Erro ao carregar projetos:', error);
    }
  };

  const createProject = async () => {
    const name = prompt('Nome do projeto:');
    if (!name) return;
    
    const framework = prompt('Framework (react/nextjs/html/node):', 'react');
    
    try {
      const response = await axios.post(
        `${API_URL}/api/projects`,
        { 
          name, 
          description: '', 
          framework,
          buildCommand: framework === 'react' ? 'npm run build' : 'npm run build',
          startCommand: framework === 'nextjs' ? 'npm start' : null,
          outputDir: framework === 'react' ? 'dist' : 'build',
          port: 3000
        },
        axiosConfig
      );
      setProjects([...projects, response.data]);
      setCurrentProject(response.data);
    } catch (error) {
      alert('Erro ao criar projeto');
    }
  };

  const loadFiles = async () => {
    try {
      const response = await axios.get(
        `${API_URL}/api/files/project/${currentProject.id}`,
        axiosConfig
      );
      setFiles(response.data);
      if (response.data.length > 0 && !currentFile) {
        setCurrentFile(response.data[0]);
      }
    } catch (error) {
      console.error('Erro ao carregar arquivos:', error);
    }
  };

  const createFile = async () => {
    const name = prompt('Nome do arquivo (ex: App.jsx):');
    if (!name) return;
    
    const path = `/src/${name}`;
    const fileType = name.split('.').pop();
    
    try {
      const response = await axios.post(
        `${API_URL}/api/files`,
        {
          projectId: currentProject.id,
          name,
          path,
          content: '// Novo arquivo\n',
          fileType
        },
        axiosConfig
      );
      setFiles([...files, response.data]);
      setCurrentFile(response.data);
    } catch (error) {
      alert('Erro ao criar arquivo');
    }
  };

  const saveFile = async () => {
    if (!currentFile) return;
    
    try {
      await axios.put(
        `${API_URL}/api/files/${currentFile.id}`,
        { content: currentFile.content },
        axiosConfig
      );
      alert('Arquivo salvo!');
    } catch (error) {
      alert('Erro ao salvar arquivo');
    }
  };

  const loadConversations = async () => {
    try {
      const response = await axios.get(
        `${API_URL}/api/conversations/project/${currentProject.id}`,
        axiosConfig
      );
      setConversations(response.data);
      if (response.data.length > 0 && !currentConversation) {
        setCurrentConversation(response.data[0]);
      }
    } catch (error) {
      console.error('Erro ao carregar conversas:', error);
    }
  };

  const createConversation = async () => {
    try {
      const response = await axios.post(
        `${API_URL}/api/conversations`,
        { projectId: currentProject.id, title: 'Nova Conversa' },
        axiosConfig
      );
      setConversations([response.data, ...conversations]);
      setCurrentConversation(response.data);
    } catch (error) {
      alert('Erro ao criar conversa');
    }
  };

  const loadMessages = async () => {
    try {
      const response = await axios.get(
        `${API_URL}/api/messages/${currentConversation.id}`,
        axiosConfig
      );
      setMessages(response.data);
    } catch (error) {
      console.error('Erro ao carregar mensagens:', error);
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!messageInput.trim()) return;
    
    setLoading(true);
    const userMessage = messageInput;
    setMessageInput('');
    
    setMessages([...messages, { role: 'user', content: userMessage }]);
    
    try {
      const response = await axios.post(
        `${API_URL}/api/chat`,
        {
          conversationId: currentConversation.id,
          projectId: currentProject.id,
          message: userMessage
        },
        axiosConfig
      );
      
      setMessages(prev => [...prev, { role: 'assistant', content: response.data.message }]);
    } catch (error) {
      alert('Erro ao enviar mensagem');
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // FUNÇÕES DE DEPLOY
  // ============================================

  const loadDeployments = async () => {
    try {
      const response = await axios.get(
        `${API_URL}/api/deploys/${currentProject.id}`,
        axiosConfig
      );
      setDeployments(response.data);
    } catch (error) {
      console.error('Erro ao carregar deploys:', error);
    }
  };

  const handleDeploy = async () => {
    if (!confirm('Deseja fazer deploy deste projeto?')) return;
    
    setIsDeploying(true);
    setDeployLogs([]);
    setShowDeployPanel(true);
    
    try {
      const response = await axios.post(
        `${API_URL}/api/deploy/${currentProject.id}`,
        { commitMessage: 'Deploy manual' },
        axiosConfig
      );
      
      // Socket vai receber os logs em tempo real
    } catch (error) {
      alert('Erro ao iniciar deploy');
      setIsDeploying(false);
    }
  };

  const loadDomains = async () => {
    try {
      const response = await axios.get(
        `${API_URL}/api/domains/${currentProject.id}`,
        axiosConfig
      );
      setDomains(response.data);
    } catch (error) {
      console.error('Erro ao carregar domínios:', error);
    }
  };

  const addDomain = async () => {
    if (!newDomain.trim()) return;
    
    try {
      await axios.post(
        `${API_URL}/api/domains`,
        { projectId: currentProject.id, domain: newDomain },
        axiosConfig
      );
      setNewDomain('');
      setShowDomainModal(false);
      loadDomains();
      alert('Domínio adicionado! Configure o DNS para apontar para este servidor.');
    } catch (error) {
      alert('Erro ao adicionar domínio');
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'building':
        return <Loader className="animate-spin text-blue-500" size={16} />;
      case 'running':
        return <CheckCircle className="text-green-500" size={16} />;
      case 'failed':
        return <XCircle className="text-red-500" size={16} />;
      case 'stopped':
        return <Clock className="text-gray-500" size={16} />;
      default:
        return null;
    }
  };

  const getStatusText = (status) => {
    const statusMap = {
      building: 'Construindo',
      running: 'Online',
      failed: 'Erro',
      stopped: 'Parado'
    };
    return statusMap[status] || status;
  };

  // Tela de Login
  if (!token) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="bg-gray-800 p-8 rounded-lg shadow-xl max-w-md w-full">
          <h1 className="text-3xl font-bold text-white mb-6 text-center">
            🚀 CriaCode
          </h1>
          <p className="text-gray-400 text-center mb-6">
            Plataforma de Desenvolvimento com IA e Deploy Automático
          </p>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-gray-300 block mb-2">Email</label>
              <input
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                className="w-full px-4 py-2 bg-gray-700 text-white rounded border border-gray-600"
                required
              />
            </div>
            <div>
              <label className="text-gray-300 block mb-2">Senha</label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full px-4 py-2 bg-gray-700 text-white rounded border border-gray-600"
                required
              />
            </div>
            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded font-semibold"
            >
              Entrar
            </button>
          </form>
          <p className="text-gray-400 text-sm mt-4 text-center">
            Usuário padrão: admin@criacode.com / admin123
          </p>
        </div>
      </div>
    );
  }

  // Interface Principal
  return (
    <div className="h-screen flex flex-col bg-gray-900">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-white">🚀 CriaCode</h1>
          <select
            value={currentProject?.id || ''}
            onChange={(e) => {
              const project = projects.find(p => p.id === parseInt(e.target.value));
              setCurrentProject(project);
            }}
            className="bg-gray-700 text-white px-3 py-1 rounded"
          >
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            onClick={createProject}
            className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded flex items-center gap-1"
          >
            <Plus size={16} />
            Novo Projeto
          </button>
        </div>
        
        <div className="flex items-center gap-3">
          {currentProject && (
            <>
              <button
                onClick={() => setShowDeployPanel(!showDeployPanel)}
                className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1 rounded flex items-center gap-1"
              >
                <Settings size={16} />
                Deploys
              </button>
              <button
                onClick={handleDeploy}
                disabled={isDeploying}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-1 rounded flex items-center gap-2 disabled:opacity-50"
              >
                <Rocket size={16} />
                {isDeploying ? 'Publicando...' : 'Publicar'}
              </button>
              <button
                onClick={() => setShowDomainModal(true)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1 rounded flex items-center gap-1"
              >
                <Globe size={16} />
                Domínios
              </button>
            </>
          )}
          <button
            onClick={handleLogout}
            className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded flex items-center gap-1"
          >
            <LogOut size={16} />
            Sair
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        <Split
          className="flex w-full"
          sizes={showDeployPanel ? [15, 40, 20, 25] : [20, 50, 30]}
          minSize={150}
          gutterSize={8}
          style={{ display: 'flex', height: '100%' }}
        >
          {/* Sidebar - Arquivos */}
          <div className="bg-gray-800 border-r border-gray-700 flex flex-col">
            <div className="p-3 border-b border-gray-700 flex items-center justify-between">
              <h2 className="text-white font-semibold flex items-center gap-2">
                <FolderOpen size={18} />
                Arquivos
              </h2>
              <button
                onClick={createFile}
                className="text-blue-400 hover:text-blue-300"
              >
                <Plus size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {files.map(file => (
                <div
                  key={file.id}
                  onClick={() => setCurrentFile(file)}
                  className={`px-3 py-2 cursor-pointer hover:bg-gray-700 flex items-center gap-2 ${
                    currentFile?.id === file.id ? 'bg-gray-700' : ''
                  }`}
                >
                  <FileCode size={16} className="text-blue-400" />
                  <span className="text-gray-300 text-sm">{file.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Editor */}
          <div className="flex flex-col bg-gray-900">
            <div className="bg-gray-800 border-b border-gray-700 px-4 py-2 flex items-center justify-between">
              <span className="text-white font-mono text-sm">
                {currentFile?.name || 'Nenhum arquivo selecionado'}
              </span>
              <button
                onClick={saveFile}
                className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded flex items-center gap-1 text-sm"
              >
                <Save size={14} />
                Salvar
              </button>
            </div>
            <div className="flex-1">
              {currentFile ? (
                <Editor
                  height="100%"
                  language={currentFile.file_type === 'jsx' ? 'javascript' : currentFile.file_type}
                  theme="vs-dark"
                  value={currentFile.content}
                  onChange={(value) => setCurrentFile({ ...currentFile, content: value })}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 14,
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    automaticLayout: true
                  }}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-gray-500">
                  Selecione um arquivo para editar
                </div>
              )}
            </div>
          </div>

          {/* Panel de Deploys */}
          {showDeployPanel && (
            <div className="bg-gray-800 border-r border-gray-700 flex flex-col">
              <div className="p-3 border-b border-gray-700">
                <h2 className="text-white font-semibold">Deploys</h2>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {deployments.map(deploy => (
                  <div
                    key={deploy.id}
                    className="bg-gray-700 p-3 rounded"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(deploy.status)}
                        <span className="text-sm text-white font-medium">
                          {getStatusText(deploy.status)}
                        </span>
                      </div>
                      <span className="text-xs text-gray-400">
                        {new Date(deploy.created_at).toLocaleString('pt-BR')}
                      </span>
                    </div>
                    {deploy.url && deploy.status === 'running' && (
                      <a
                        href={deploy.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                      >
                        <ExternalLink size={12} />
                        Ver projeto
                      </a>
                    )}
                    {deploy.build_duration && (
                      <p className="text-xs text-gray-400 mt-1">
                        Duração: {deploy.build_duration}s
                      </p>
                    )}
                  </div>
                ))}
                
                {isDeploying && deployLogs.length > 0 && (
                  <div className="bg-black p-3 rounded mt-4">
                    <h3 className="text-white text-sm font-semibold mb-2">
                      Logs em tempo real:
                    </h3>
                    <div className="space-y-1 max-h-64 overflow-y-auto">
                      {deployLogs.map((log, idx) => (
                        <div
                          key={idx}
                          className={`text-xs font-mono ${
                            log.type === 'error' ? 'text-red-400' : 
                            log.type === 'warning' ? 'text-yellow-400' : 
                            'text-green-400'
                          }`}
                        >
                          {log.message}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Chat com IA */}
          <div className="bg-gray-800 border-l border-gray-700 flex flex-col">
            <div className="p-3 border-b border-gray-700 flex items-center justify-between">
              <h2 className="text-white font-semibold flex items-center gap-2">
                <MessageSquare size={18} />
                Chat IA
              </h2>
              <button
                onClick={createConversation}
                className="text-blue-400 hover:text-blue-300"
              >
                <Plus size={18} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`p-3 rounded ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white ml-8'
                      : 'bg-gray-700 text-gray-100 mr-8'
                  }`}
                >
                  <div className="text-xs mb-1 opacity-75">
                    {msg.role === 'user' ? 'Você' : '🤖 IA'}
                  </div>
                  <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                </div>
              ))}
              {loading && (
                <div className="bg-gray-700 text-gray-100 mr-8 p-3 rounded">
                  <div className="text-xs mb-1 opacity-75">🤖 IA</div>
                  <div className="text-sm">Pensando...</div>
                </div>
              )}
            </div>

            <form onSubmit={sendMessage} className="p-3 border-t border-gray-700">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  placeholder="Digite sua mensagem..."
                  className="flex-1 bg-gray-700 text-white px-3 py-2 rounded border border-gray-600"
                  disabled={loading}
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded disabled:opacity-50"
                >
                  <Send size={18} />
                </button>
              </div>
            </form>
          </div>
        </Split>
      </div>

      {/* Modal de Domínios */}
      {showDomainModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full">
            <h2 className="text-xl font-bold text-white mb-4">Gerenciar Domínios</h2>
            
            <div className="space-y-3 mb-4">
              {domains.map(domain => (
                <div
                  key={domain.id}
                  className="bg-gray-700 p-3 rounded flex items-center justify-between"
                >
                  <div>
                    <p className="text-white font-medium">{domain.domain}</p>
                    <p className="text-xs text-gray-400">
                      {domain.ssl_enabled ? '🔒 SSL Ativo' : '⚠️ SSL Pendente'}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-gray-700 pt-4">
              <label className="text-gray-300 block mb-2">Adicionar novo domínio</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  placeholder="exemplo.com"
                  className="flex-1 px-3 py-2 bg-gray-700 text-white rounded border border-gray-600"
                />
                <button
                  onClick={addDomain}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
                >
                  Adicionar
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Configure o DNS do seu domínio para apontar para este servidor
              </p>
            </div>

            <button
              onClick={() => setShowDomainModal(false)}
              className="mt-4 w-full bg-gray-700 hover:bg-gray-600 text-white py-2 rounded"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;