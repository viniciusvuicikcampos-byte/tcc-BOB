import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

const app = express();
const PORT = process.env.PORT || 3001;

const URL_API = 'https://api.groq.com/openai/v1/chat/completions';
const MODELO = 'openai/gpt-oss-120b';

app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(express.static('public'));

const usuarios = [];
const sessoes = new Map();

// ===============================
// CADASTRO
// ===============================
app.post('/cadastro', (req, res) => {
    const { usuario, email, senha } = req.body;

    if (
        typeof usuario !== 'string' ||
        typeof email !== 'string' ||
        typeof senha !== 'string' ||
        !usuario.trim() ||
        !email.trim() ||
        !senha
    ) {
        return res.status(400).json({
            erro: 'Preencha todos os campos!'
        });
    }

    if (senha.length < 6) {
        return res.status(400).json({
            erro: 'A senha deve ter pelo menos 6 caracteres!'
        });
    }

    const emailNormalizado = email.trim().toLowerCase();

    const existente = usuarios.find(
        u => u.email === emailNormalizado
    );

    if (existente) {
        return res.status(409).json({
            erro: 'E-mail já cadastrado!'
        });
    }

    const salt = randomUUID();
    const hash = scryptSync(senha, salt, 64).toString('hex');

    usuarios.push({
        usuario: usuario.trim(),
        email: emailNormalizado,
        salt,
        hash
    });

    console.log('Novo cadastro:', usuario.trim());

    return res.status(201).json({
        mensagem: 'Cadastro realizado com sucesso!'
    });
});

// ===============================
// LOGIN
// ===============================
app.post('/login', (req, res) => {
    const { email, senha } = req.body;

    if (
        typeof email !== 'string' ||
        typeof senha !== 'string' ||
        !email.trim() ||
        !senha
    ) {
        return res.status(400).json({
            erro: 'Preencha e-mail e senha!'
        });
    }

    const usuarioEncontrado = usuarios.find(
        u => u.email === email.trim().toLowerCase()
    );

    if (!usuarioEncontrado) {
        return res.status(401).json({
            erro: 'E-mail ou senha incorretos!'
        });
    }

    const hashRecebido = scryptSync(
        senha,
        usuarioEncontrado.salt,
        64
    );

    const hashArmazenado = Buffer.from(
        usuarioEncontrado.hash,
        'hex'
    );

    if (!timingSafeEqual(hashRecebido, hashArmazenado)) {
        return res.status(401).json({
            erro: 'E-mail ou senha incorretos!'
        });
    }

    const token = randomUUID();

    sessoes.set(token, {
        usuario: usuarioEncontrado.usuario
    });

    return res.json({
        mensagem: 'Login realizado com sucesso!',
        usuario: usuarioEncontrado.usuario,
        token
    });
});

// ===============================
// AUTENTICAÇÃO
// ===============================
function autenticar(req, res, next) {
    const cabecalho = req.headers.authorization || '';

    if (!cabecalho.startsWith('Bearer ')) {
        return res.status(401).json({
            erro: 'Faça login para acessar o chatbot.'
        });
    }

    const token = cabecalho.slice(7);
    const sessao = sessoes.get(token);

    if (!sessao) {
        return res.status(401).json({
            erro: 'Sessão inválida. Faça login novamente.'
        });
    }

    req.token = token;
    req.usuario = sessao.usuario;

    next();
}

// ===============================
// CHATBOT DO NEYMAR
// ===============================
app.post('/chat', autenticar, async (req, res) => {
    try {
        const API_KEY = process.env.GROQ_API_KEY;

        if (!API_KEY) {
            return res.status(500).json({
                erro: 'Configure GROQ_API_KEY no arquivo .env.'
            });
        }

        const historico = req.body.historico;

        if (
            !Array.isArray(historico) ||
            historico.length === 0
        ) {
            return res.status(400).json({
                erro: 'Digite uma mensagem para conversar.'
            });
        }

        const mensagensValidas = historico
            .slice(-20)
            .filter(m =>
                m &&
                ['user', 'assistant'].includes(m.role) &&
                typeof m.content === 'string' &&
                m.content.trim().length > 0 &&
                m.content.length <= 4000
            )
            .map(m => ({
                role: m.role,
                content: m.content
            }));

        if (
            mensagensValidas.length === 0 ||
            mensagensValidas[mensagensValidas.length - 1].role !== 'user'
        ) {
            return res.status(400).json({
                erro: 'Envie uma mensagem válida.'
            });
        }

        const respostaAPI = await fetch(URL_API, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            },
            body: JSON.stringify({
                model: MODELO,
                messages: [
                    {
                        role: 'system',
                        content:
                            'Você interpreta Neymar Jr. em uma conversa ' +
                            'fictícia com um fã. Responda em português ' +
                            'brasileiro, de forma curta, simpática, ' +
                            'objetiva e bem-humorada. Não afirme ser ' +
                            'o Neymar real.'
                    },
                    ...mensagensValidas
                ],
                temperature: 0.7,
                max_completion_tokens: 500
            })
        });

        const dados = await respostaAPI.json();

        if (!respostaAPI.ok) {
            console.error('Erro da Groq:', respostaAPI.status, dados);

            return res.status(502).json({
                erro: 'A Groq não conseguiu responder. Verifique a chave, o modelo e os limites da API.'
            });
        }

        const resposta = dados.choices?.[0]?.message?.content;

        if (typeof resposta !== 'string' || !resposta.trim()) {
            return res.status(502).json({
                erro: 'A API não retornou uma resposta válida.'
            });
        }

        return res.json({ resposta });

    } catch (erro) {
        console.error('Erro no chatbot:', erro);

        return res.status(500).json({
            erro: 'Falha ao conversar com o chatbot. Tente novamente.'
        });
    }
});

// ===============================
// SAIR DA CONTA
// ===============================
app.post('/logout', autenticar, (req, res) => {
    sessoes.delete(req.token);

    return res.json({
        mensagem: 'Você saiu da conta.'
    });
});

// ===============================
// JAVASCRIPT DO NAVEGADOR
// ===============================
const codigoNavegador = String.raw`
(() => {
    const formulario = document.querySelector('#bat-form');
    const campoMensagem = document.querySelector('#campoMensagem');
    const botaoEnviar = document.querySelector('#botaoEnviar');
    const chatMensagens = document.querySelector('#chatMensagens');

    // CHATBOT (Se acessar o chat sem autenticação, vai para o CADASTRO)
    if (campoMensagem && botaoEnviar && chatMensagens) {
        const token = sessionStorage.getItem('tokenChat');
        const usuario = localStorage.getItem('usuarioLogado');

        if (!token || !usuario) {
            window.location.replace('cadastro.html');
            return;
        }

        const historico = [];

        function adicionarMensagem(nome, texto, classe) {
            const mensagem = document.createElement('div');
            mensagem.className = 'mensagem ' + classe;

            const titulo = document.createElement('span');
            titulo.textContent = nome;

            const paragrafo = document.createElement('p');
            paragrafo.textContent = texto;

            mensagem.append(titulo, paragrafo);
            chatMensagens.appendChild(mensagem);

            chatMensagens.scrollTop = chatMensagens.scrollHeight;
        }

        async function enviarMensagem() {
            const texto = campoMensagem.value.trim();

            if (!texto || botaoEnviar.disabled) return;

            adicionarMensagem('Você', texto, 'mensagem-usuario');

            historico.push({
                role: 'user',
                content: texto
            });

            campoMensagem.value = '';
            campoMensagem.disabled = true;
            botaoEnviar.disabled = true;

            try {
                const resposta = await fetch('/chat', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify({ historico })
                });

                const dados = await resposta.json();

                if (resposta.status === 401) {
                    sessionStorage.removeItem('tokenChat');
                    localStorage.removeItem('usuarioLogado');

                    alert('Sua sessão expirou. Registre-se novamente.');
                    window.location.replace('cadastro.html');
                    return;
                }

                if (!resposta.ok) {
                    throw new Error(
                        dados.erro || 'Erro ao receber resposta.'
                    );
                }

                historico.push({
                    role: 'assistant',
                    content: dados.resposta
                });

                adicionarMensagem(
                    'Neymar',
                    dados.resposta,
                    'mensagem-neymar'
                );

            } catch (erro) {
                historico.pop();

                adicionarMensagem(
                    'Sistema',
                    erro.message || 'Erro de conexão.',
                    'mensagem-neymar'
                );

            } finally {
                campoMensagem.disabled = false;
                botaoEnviar.disabled = false;
                campoMensagem.focus();
            }
        }

        botaoEnviar.addEventListener('click', enviarMensagem);

        campoMensagem.addEventListener('keydown', evento => {
            if (evento.key === 'Enter') {
                evento.preventDefault();
                enviarMensagem();
            }
        });

        return;
    }

    // CADASTRO E LOGIN
    if (formulario) {
        formulario.addEventListener('submit', async evento => {
            evento.preventDefault();

            const nome = document.querySelector('#nome');
            const campoEmail = document.querySelector('#email');
            const campoSenha = document.querySelector('#senha');
            const botao = formulario.querySelector('button[type="submit"], button:not([type])');

            const cadastro = Boolean(nome);

            const dados = {
                email: campoEmail.value.trim(),
                senha: campoSenha.value
            };

            if (cadastro) {
                dados.usuario = nome.value.trim();
            }

            if (botao) botao.disabled = true;

            try {
                const resposta = await fetch(
                    cadastro ? '/cadastro' : '/login',
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(dados)
                    }
                );

                const resultado = await resposta.json();

                if (!resposta.ok) {
                    alert(resultado.erro || 'Não foi possível continuar.');
                    return;
                }

                if (cadastro) {
                    alert('Cadastro realizado com sucesso! Agora faça o login.');
                    window.location.href = 'login.html';
                    return;
                }

                localStorage.setItem(
                    'usuarioLogado',
                    resultado.usuario
                );

                sessionStorage.setItem(
                    'tokenChat',
                    resultado.token
                );

                window.location.href = 'index.html';

            } catch (erro) {
                console.error(erro);

                alert(
                    'Não foi possível conectar ao servidor. ' +
                    'Confira se ele está ligado.'
                );

            } finally {
                if (botao) botao.disabled = false;
            }
        });
    }
})();
`;

app.get('/app.js', (req, res) => {
    res.type('application/javascript').send(codigoNavegador);
});

// ===============================
// INICIAR SERVIDOR
// ===============================
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});