# Etapa base com Node
FROM node:18-alpine

# Define diretório de trabalho
WORKDIR /app

# Copia tudo
COPY . .

# Entra na pasta backend e instala dependências
WORKDIR /app/backend
RUN npm install

# Expõe a porta configurada
EXPOSE 3001

# Comando de inicialização
CMD ["node", "server.js"]
