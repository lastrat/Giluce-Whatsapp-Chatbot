/**
 * Anime Quiz Command - Start an anime quiz competition
 * Questions are loaded from database/quiz_anime.txt
 * Format: Question line, then Answer line (repeat)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');
const config = require('../../config');

const QUIZ_FILE = path.join(__dirname, '../../database/quiz_anime.txt');
const activeQuizzes = new Map();

function httpGet(urlString) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlString);
        const options = {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: 'GET',
            headers: { 'User-Agent': 'Mozilla/5.0' }
        };
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error('timeout'));
        });
        req.end();
    });
}

function httpPost(urlString, body, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlString);
        const payload = typeof body === 'string' ? body : JSON.stringify(body);
        const options = {
            hostname: url.hostname,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
            req.destroy();
            reject(new Error('timeout'));
        });
        req.write(payload);
        req.end();
    });
}

async function askLMStudio(prompt) {
    const lmConfig = config?.lmStudio || {};
    if (!lmConfig.enabled || !lmConfig.url || !lmConfig.model) return null;
    const payload = {
        model: lmConfig.model,
        messages: [
            { role: 'system', content: 'Answer ONLY with true or false.' },
            { role: 'user', content: prompt }
        ],
        temperature: 0,
        max_tokens: 20,
        stream: false
    };
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        const response = await fetch(lmConfig.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        const text = await response.text();
        console.log('[Quiz LM Studio] Raw response:', text);
        try {
            const data = JSON.parse(text);
            const content = data?.choices?.[0]?.message?.content || '';
            const normalized = content.toLowerCase().replace(/[^a-z]/g, '');
            if (normalized.includes('true')) return true;
            if (normalized.includes('false')) return false;
            return null;
        } catch {
            return null;
        }
    } catch (error) {
        console.error('[Quiz LM Studio] Error:', error.message);
        return null;
    }
}

async function wikipediaSearch(query) {
    const endpoint = `https://fr.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=1`;
    const raw = await httpGet(endpoint);
    const data = JSON.parse(raw);
    return data.query?.search?.[0]?.title || null;
}

async function isSameEntity(answer1, answer2) {
    try {
        const [title1, title2] = await Promise.all([
            wikipediaSearch(answer1),
            wikipediaSearch(answer2)
        ]);
        if (!title1 || !title2) return false;
        return normalizeAnswer(title1) === normalizeAnswer(title2);
    } catch {
        return false;
    }
}

const STOP_WORDS = new Set([
    'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'au', 'aux',
    'et', 'ou', 'mais', 'donc', 'or', 'ni', 'car', 'pour', 'par',
    'dans', 'sur', 'avec', 'sans', 'sous', 'entre', 'vers', 'depuis',
    'pendant', 'pour', 'contre', 'avant', 'après', 'cette', 'ces',
    'celui', 'celle', 'ceux', 'celles', 'ce', 'ça', 'cela', 'autre',
    'autres', 'meme', 'mêmes', 'notre', 'votre', 'leur', 'leurs',
    'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses',
    'est', 'sont', 'etait', 'etaient', 'etre', 'avoir', 'a', 'ont',
    'peut', 'peuvent', 'il', 'elle', 'ils', 'elles', 'on', 'nous',
    'vous', 'je', 'tu', 'me', 'te', 'se', 'lui', 'y', 'en', 'qui',
    'que', 'quoi', 'dont', 'ou', 'ne', 'pas', 'plus', 'moins', 'très',
    'bien', 'mal', 'aussi', 'ainsi', 'alors', 'donc', 'si', 'comme',
    'quel', 'quelle', 'quels', 'quelles', 'tout', 'tous', 'toute',
    'toutes', 'autre', 'autres', 'non', 'oui', 'mais', 'donc', 'car',
    'parce', 'parce que', 'alors que', 'lorsque', 'puisque', 'quoi que',
    'celui qui', 'celle qui', 'ceux qui', 'celles qui'
]);

function normalizeAnswer(text) {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenize(text) {
    return text.split(' ').filter(word => word.length > 0 && !STOP_WORDS.has(word));
}

function jaccardSimilarity(setA, setB) {
    if (setA.size === 0 && setB.size === 0) return 0;
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return intersection.size / union.size;
}

function looksLikeNamedEntity(text) {
    const words = text.split(' ').filter(w => w.length > 0);
    if (words.length === 0) return false;
    const capitalized = words.filter(w => /^[A-ZÀ-Ü]/.test(w));
    return capitalized.length >= 1 && words.length <= 8;
}

async function isAnswerCorrect(question, userAnswer, correctAnswer) {
    const normalizedUser = normalizeAnswer(userAnswer);
    const normalizedCorrect = normalizeAnswer(correctAnswer);

    if (normalizedUser === normalizedCorrect) return true;

    const aiVerdict = await askLMStudio(`You are a permissive but accurate quiz validator.
Question: "${question}"
Correct answer: "${correctAnswer}"
User answer: "${userAnswer}"
Accept the user's answer if it is clearly the same person/thing as the correct answer, even if shortened, abbreviated, or partially reversed.
Reject only if it is clearly wrong or unrelated.
Respond ONLY with "true" or "false".`);
    if (typeof aiVerdict === 'boolean') return aiVerdict;

    const userTokens = tokenize(normalizedUser);
    const correctTokens = tokenize(normalizedCorrect);
    if (userTokens.length === 0 && correctTokens.length === 0) {
        return normalizedUser === normalizedCorrect;
    }

    if (looksLikeNamedEntity(userAnswer) && looksLikeNamedEntity(correctAnswer)) {
        const sameEntity = await isSameEntity(userAnswer, correctAnswer);
        if (sameEntity) return true;
    }

    const similarity = jaccardSimilarity(new Set(userTokens), new Set(correctTokens));
    const userSet = new Set(userTokens);
    const correctSet = new Set(correctTokens);
    const containsMostCorrect = [...correctSet].filter(t => userSet.has(t)).length >= Math.max(1, Math.ceil(correctTokens.length * 0.6));

    return similarity >= 0.5 && containsMostCorrect;
}

function loadQuestions() {
    try {
        const content = fs.readFileSync(QUIZ_FILE, 'utf-8');
        const questions = [];
        const lines = content.split('\n');
        let i = 0;
        while (i < lines.length) {
            const question = lines[i]?.trim();
            const answer = lines[i + 1]?.trim();
            if (question && answer) {
                questions.push({ question, answer });
            }
            i += 2;
        }
        return questions;
    } catch {
        return [];
    }
}

function getActiveQuiz(groupId) {
    return activeQuizzes.get(groupId);
}

function setActiveQuiz(groupId, state) {
    activeQuizzes.set(groupId, state);
}

function clearQuiz(groupId) {
    activeQuizzes.delete(groupId);
}

module.exports = {
    name: 'quiz',
    aliases: ['anime-quiz', 'aq'],
    category: 'fun',
    description: 'Start an anime quiz competition',
    usage: '.quiz [stop|count] [duration]',
    activeQuizzes,
    getActiveQuiz,
    setActiveQuiz,
    clearQuiz,
    loadQuestions,
    isAnswerCorrect,

    async execute(sock, msg, args, context) {
        const { from } = context;

        if (args[0]?.toLowerCase() === 'stop') {
            const quiz = getActiveQuiz(from);
            if (!quiz) {
                return await sock.sendMessage(from, { text: '❌ No active quiz in this group.' });
            }
            clearTimeout(quiz.timeoutId);
            clearQuiz(from);
            await this.showFinalScores(sock, from, quiz);
            return;
        }

        if (getActiveQuiz(from)) {
            return await sock.sendMessage(from, { text: '❌ A quiz is already active in this group!' });
        }

        const questions = loadQuestions();
        if (questions.length === 0) {
            return await sock.sendMessage(from, { text: '❌ No quiz questions found.' });
        }

        const requestedCount = Math.max(1, Math.min(questions.length, parseInt(args[0] || '10', 10) || 10));
        const durationMs = Math.max(5, Math.min(300, parseInt(args[1] || '15', 10) || 15)) * 1000;
        const shuffled = questions.sort(() => Math.random() - 0.5).slice(0, requestedCount);
        const scores = new Map();
        const players = new Set();
        const playerNames = new Map();

        const quiz = {
            questions: shuffled,
            currentIndex: 0,
            scores,
            players,
            playerNames,
            durationMs,
            timeoutId: null,
            groupId: from,
            questionAnswered: false,
            currentQuestion: null,
            transitioning: false,
        };

        setActiveQuiz(from, quiz);

        await sock.sendMessage(from, {
            text: `🎯 *Anime Quiz Started!*\n\n📋 ${shuffled.length} questions\n⏱️ ${quiz.durationMs / 1000} seconds per question\n\nSend your answers directly in chat!\nGood luck! 🍀`
        });

        await this.askQuestion(sock, from, quiz);
    },

    async askQuestion(sock, groupId, quiz) {
        if (quiz.currentIndex >= quiz.questions.length) {
            clearTimeout(quiz.timeoutId);
            clearQuiz(groupId);
            await this.showFinalScores(sock, groupId, quiz);
            return;
        }

        if (quiz.transitioning) return;
        quiz.transitioning = true;
        clearTimeout(quiz.timeoutId);
        quiz.questionAnswered = false;

        const q = quiz.questions[quiz.currentIndex];
        quiz.currentQuestion = q;

        await sock.sendMessage(groupId, {
            text: `❓ *Question ${quiz.currentIndex + 1}/${quiz.questions.length}*\n\n${q.question}\n\n⏱️ You have ${quiz.durationMs / 1000} seconds to answer!`
        });

        quiz.transitioning = false;
        quiz.timeoutId = setTimeout(async () => {
            await this.timeUp(sock, groupId, quiz);
        }, quiz.durationMs);
    },

    async timeUp(sock, groupId, quiz) {
        if (quiz.questionAnswered) return;
        quiz.questionAnswered = true;

        await sock.sendMessage(groupId, {
            text: `⏰ *Time's up!*\n\nThe correct answer was: *${quiz.currentQuestion.answer}*\n\n➡️ Next question...`
        });

        quiz.currentIndex++;
        setTimeout(() => {
            this.askQuestion(sock, groupId, quiz);
        }, 2000);
    },

    async handleQuizAnswer(sock, msg, groupId, sender, body) {
        const quiz = getActiveQuiz(groupId);
        if (!quiz) return false;
        if (quiz.questionAnswered) return false;

        const q = quiz.currentQuestion;
        if (!q) return false;

        const trimmed = body.trim().toLowerCase();
        if (trimmed === 'pass') {
            quiz.questionAnswered = true;
            clearTimeout(quiz.timeoutId);

            await sock.sendMessage(groupId, {
                text: `⏭️ *Passed!*\n\nThe correct answer was: *${q.answer}*\n\n➡️ Next question...`
            });

            quiz.currentIndex++;
            setTimeout(() => {
                this.askQuestion(sock, groupId, quiz);
            }, 2000);
            return true;
        }

        const isCorrect = await this.isAnswerCorrect(q.question, body, q.answer);

        if (isCorrect) {
            quiz.questionAnswered = true;
            clearTimeout(quiz.timeoutId);

            quiz.scores.set(sender, (quiz.scores.get(sender) || 0) + 1);
            quiz.players.add(sender);
            if (!quiz.playerNames.has(sender)) {
                quiz.playerNames.set(sender, msg.pushName || sender.split('@')[0]);
            }

            await sock.sendMessage(groupId, {
                text: `✅ *Correct!* +1 point 🎉\n\nThe answer was: *${q.answer}*\n\n➡️ Next question...`
            });

            quiz.currentIndex++;
            setTimeout(() => {
                this.askQuestion(sock, groupId, quiz);
            }, 2000);
        } else {
            await sock.sendMessage(groupId, {
                text: '❌ Wrong answer! Try again...'
            });
        }

        return true;
    },

    async showFinalScores(sock, groupId, quiz) {
        const scores = Array.from(quiz.scores.entries())
            .sort((a, b) => b[1] - a[1]);

        if (scores.length === 0) {
            return await sock.sendMessage(groupId, {
                text: '🏁 *Quiz Finished!*\n\nNo one scored any points. Better luck next time!'
            });
        }

        let leaderboard = '🏆 *Final Scores*\n\n';
        scores.forEach(([player, score], index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
            const name = quiz.playerNames.get(player) || player.split('@')[0];
            leaderboard += `${medal} ${name} = ${score} pts\n`;
        });

        await sock.sendMessage(groupId, {
            text: leaderboard
        });
    },

    async handleSelection(sock, msg, from, body) {
        const quiz = getActiveQuiz(from);
        if (!quiz) return false;

        const sender = msg.key?.participant || from;
        const handled = await this.handleQuizAnswer(sock, msg, from, sender, body);
        if (handled) return true;

        return false;
    }
};
