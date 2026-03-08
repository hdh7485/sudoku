// 스파이더 카드놀이
(function () {
    "use strict";

    const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    const SUIT_SYMBOLS = { spade: "♠", heart: "♥", diamond: "♦", club: "♣" };
    const SUIT_COLORS = { spade: "black", heart: "red", diamond: "red", club: "black" };

    const NUM_COLUMNS = 10;
    const TOTAL_CARDS = 104; // 2 decks

    let state = {
        columns: [],       // 10 columns of cards
        stock: [],         // remaining cards to deal
        completed: [],     // completed suit sets
        numSuits: 1,
        moves: 0,
        score: 500,
        timer: 0,
        timerInterval: null,
        selectedCol: -1,
        selectedIdx: -1,
        history: [],
        animating: false,
    };

    // === 덱 생성 ===
    function createDeck(numSuits) {
        const suitList = ["spade", "heart", "diamond", "club"].slice(0, numSuits);
        const deck = [];
        const decksNeeded = TOTAL_CARDS / (13 * numSuits);
        for (let d = 0; d < decksNeeded; d++) {
            for (const suit of suitList) {
                for (let r = 0; r < 13; r++) {
                    deck.push({ rank: r, suit, faceUp: false });
                }
            }
        }
        return deck;
    }

    function shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    // === 게임 초기화 ===
    function startGame(numSuits) {
        clearInterval(state.timerInterval);

        const deck = shuffle(createDeck(numSuits));

        const columns = Array.from({ length: NUM_COLUMNS }, () => []);
        // 첫 4열에 6장, 나머지 6열에 5장 (총 54장)
        let idx = 0;
        for (let c = 0; c < NUM_COLUMNS; c++) {
            const count = c < 4 ? 6 : 5;
            for (let i = 0; i < count; i++) {
                columns[c].push(deck[idx++]);
            }
            // 마지막 카드는 앞면
            columns[c][columns[c].length - 1].faceUp = true;
        }

        state = {
            columns,
            stock: deck.slice(idx), // 나머지 50장 (5세트 x 10장)
            completed: [],
            numSuits: numSuits,
            moves: 0,
            score: 500,
            timer: 0,
            timerInterval: null,
            selectedCol: -1,
            selectedIdx: -1,
            history: [],
            animating: false,
        };

        startTimer();
        showScreen("game-screen");
        render();
    }

    // === 타이머 ===
    function startTimer() {
        state.timer = 0;
        updateTimerDisplay();
        state.timerInterval = setInterval(() => {
            state.timer++;
            updateTimerDisplay();
        }, 1000);
    }

    function updateTimerDisplay() {
        const m = String(Math.floor(state.timer / 60)).padStart(2, "0");
        const s = String(state.timer % 60).padStart(2, "0");
        document.getElementById("timer").textContent = `${m}:${s}`;
    }

    // === 카드 이동 유효성 ===
    function canPickUp(col, fromIdx) {
        const cards = state.columns[col];
        if (fromIdx < 0 || fromIdx >= cards.length) return false;
        if (!cards[fromIdx].faceUp) return false;

        // 연속 내림차순 + 같은 수트인지 확인
        for (let i = fromIdx; i < cards.length - 1; i++) {
            if (cards[i].suit !== cards[i + 1].suit) return false;
            if (cards[i].rank !== cards[i + 1].rank + 1) return false;
        }
        return true;
    }

    function canPlace(toCol, card) {
        const target = state.columns[toCol];
        if (target.length === 0) return true;
        const topCard = target[target.length - 1];
        return topCard.rank === card.rank + 1;
    }

    // === 카드 이동 ===
    function moveCards(fromCol, fromIdx, toCol) {
        // FLIP: First - 이동 전 카드 위치 기록
        const movingRects = [];
        for (let i = fromIdx; i < state.columns[fromCol].length; i++) {
            movingRects.push(getCardRect(fromCol, i));
        }

        const cards = state.columns[fromCol].splice(fromIdx);
        const flippedCard = state.columns[fromCol].length > 0 &&
            !state.columns[fromCol][state.columns[fromCol].length - 1].faceUp;
        const flipped = flipTopCard(fromCol);

        state.columns[toCol].push(...cards);
        state.moves++;
        state.score = Math.max(0, state.score - 1);

        state.history.push({
            type: "move",
            fromCol,
            toCol,
            count: cards.length,
            flipped,
        });

        updateInfo();
        render();

        // FLIP: Last & Invert & Play
        const toCards = state.columns[toCol];
        const startIdx = toCards.length - cards.length;
        const animCards = [];

        for (let i = 0; i < cards.length; i++) {
            const newRect = getCardRect(toCol, startIdx + i);
            const oldRect = movingRects[i];
            if (oldRect && newRect) {
                const dx = oldRect.left - newRect.left;
                const dy = oldRect.top - newRect.top;
                const colDiv = document.querySelectorAll("#columns .column")[toCol];
                const cardDiv = colDiv.querySelectorAll(".card")[startIdx + i];
                if (cardDiv) {
                    cardDiv.style.transform = `translate(${dx}px, ${dy}px)`;
                    cardDiv.classList.add("animating-move");
                    animCards.push(cardDiv);
                }
            }
        }

        if (animCards.length > 0) {
            setAnimating(true);
            // Force reflow so browser registers initial transform
            animCards.forEach(c => forceReflow(c));
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    animCards.forEach(c => c.style.transform = "translate(0, 0)");
                });
            });
            const last = animCards[animCards.length - 1];
            onTransitionEnd(last, () => {
                animCards.forEach(c => {
                    c.classList.remove("animating-move");
                    c.style.transform = "";
                });

                // 뒤집기 애니메이션
                if (flipped) {
                    animateFlip(fromCol, state.columns[fromCol].length - 1, () => {
                        setAnimating(false);
                        checkCompleted(toCol);
                    });
                } else {
                    setAnimating(false);
                    checkCompleted(toCol);
                }
            }, 350);
        } else {
            if (flipped) {
                animateFlip(fromCol, state.columns[fromCol].length - 1, () => {
                    checkCompleted(toCol);
                });
            } else {
                checkCompleted(toCol);
            }
        }
    }

    function flipTopCard(col) {
        const cards = state.columns[col];
        if (cards.length > 0 && !cards[cards.length - 1].faceUp) {
            cards[cards.length - 1].faceUp = true;
            return true;
        }
        return false;
    }

    function animateFlip(col, idx, callback) {
        render();
        const colDiv = document.querySelectorAll("#columns .column")[col];
        if (!colDiv) { if (callback) callback(); return; }
        const cardDiv = colDiv.querySelectorAll(".card")[idx];
        if (!cardDiv) { if (callback) callback(); return; }
        cardDiv.classList.add("animating-flip");
        cardDiv.addEventListener("animationend", function handler() {
            cardDiv.removeEventListener("animationend", handler);
            cardDiv.classList.remove("animating-flip");
            if (callback) callback();
        });
    }

    // === 완성 체크 (K~A 같은 수트 13장) ===
    function checkCompleted(col) {
        const cards = state.columns[col];
        if (cards.length < 13) return;

        const startIdx = cards.length - 13;
        const bottomCard = cards[startIdx];
        if (bottomCard.rank !== 12) return; // K가 아니면 안됨

        for (let i = startIdx; i < cards.length - 1; i++) {
            if (!cards[i].faceUp) return;
            if (cards[i].suit !== cards[i + 1].suit) return;
            if (cards[i].rank !== cards[i + 1].rank + 1) return;
        }

        // 완성! 애니메이션 실행
        setAnimating(true);

        // 완성 카드 위치 기록
        const cardRects = [];
        for (let i = startIdx; i < cards.length; i++) {
            cardRects.push(getCardRect(col, i));
        }
        const targetRect = getCompletedAreaRect();

        const removed = cards.splice(startIdx, 13);
        state.completed.push(removed[0].suit);
        state.score += 100;
        const flipped = flipTopCard(col);

        state.history.push({
            type: "complete",
            col,
            suit: removed[0].suit,
            cards: removed,
        });

        updateInfo();
        render();

        // 완성된 카드를 오버레이로 순차 애니메이션
        const overlay = document.createElement("div");
        overlay.style.cssText = "position:fixed;inset:0;z-index:1500;pointer-events:none;";
        document.body.appendChild(overlay);

        const animPromises = [];
        for (let i = 12; i >= 0; i--) {
            const rect = cardRects[i];
            if (!rect || !targetRect) continue;

            const promise = new Promise(resolve => {
                setTimeout(() => {
                    const el = document.createElement("div");
                    el.className = "card face-up animating-complete " + SUIT_COLORS[removed[i].suit];
                    el.style.cssText = `
                        position:fixed;
                        left:${rect.left}px;top:${rect.top}px;
                        width:${rect.width}px;height:${rect.height}px;
                        border-radius:6px;background:#fff;
                        display:flex;flex-direction:column;padding:3px 5px;
                    `;
                    const topEl = document.createElement("div");
                    topEl.className = "card-top";
                    topEl.textContent = RANKS[removed[i].rank] + SUIT_SYMBOLS[removed[i].suit];
                    el.appendChild(topEl);
                    overlay.appendChild(el);
                    forceReflow(el);

                    requestAnimationFrame(() => {
                        const dx = targetRect.left - rect.left;
                        const dy = targetRect.top - rect.top;
                        const sx = targetRect.width / rect.width;
                        const sy = targetRect.height / rect.height;
                        el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
                        el.style.opacity = "0.6";
                    });

                    onTransitionEnd(el, () => {
                        el.remove();
                        resolve();
                    }, 500);
                }, (12 - i) * 30);
            });
            animPromises.push(promise);
        }

        Promise.all(animPromises).then(() => {
            overlay.remove();
            // 완성 세트에 바운스 효과
            const completedSets = document.querySelectorAll("#completed-area .completed-set");
            const lastSet = completedSets[completedSets.length - 1];
            if (lastSet) {
                lastSet.classList.add("bounce");
                lastSet.addEventListener("animationend", () => lastSet.classList.remove("bounce"));
            }

            if (flipped) {
                animateFlip(col, state.columns[col].length - 1, () => {
                    setAnimating(false);
                    if (state.completed.length === 8) {
                        setTimeout(showWin, 500);
                    }
                });
            } else {
                setAnimating(false);
                if (state.completed.length === 8) {
                    setTimeout(showWin, 500);
                }
            }
        });
    }

    // === 스톡에서 카드 딜 ===
    function dealFromStock() {
        if (state.stock.length === 0) return;
        if (state.animating) return;

        // 빈 열이 있으면 딜 불가
        for (let c = 0; c < NUM_COLUMNS; c++) {
            if (state.columns[c].length === 0) {
                alert("빈 열이 있으면 카드를 나눠줄 수 없습니다.\n빈 열에 카드를 놓아주세요.");
                return;
            }
        }

        setAnimating(true);

        const stockRect = getStockRect();

        // 데이터 먼저 변경
        const dealtCards = [];
        for (let c = 0; c < NUM_COLUMNS; c++) {
            const card = state.stock.pop();
            card.faceUp = true;
            state.columns[c].push(card);
            dealtCards.push({ col: c, idx: state.columns[c].length - 1 });
        }

        state.history.push({ type: "deal", count: NUM_COLUMNS });
        updateInfo();
        render();

        // 각 카드를 순차 애니메이션
        let completed = 0;
        dealtCards.forEach((info, i) => {
            const newRect = getCardRect(info.col, info.idx);
            if (!newRect || !stockRect) {
                completed++;
                if (completed === NUM_COLUMNS) finishDealAnim();
                return;
            }
            const colDiv = document.querySelectorAll("#columns .column")[info.col];
            const cardDiv = colDiv && colDiv.querySelectorAll(".card")[info.idx];
            if (!cardDiv) {
                completed++;
                if (completed === NUM_COLUMNS) finishDealAnim();
                return;
            }

            const dx = stockRect.left - newRect.left;
            const dy = stockRect.top - newRect.top;
            cardDiv.style.transform = `translate(${dx}px, ${dy}px) scale(0.8)`;
            cardDiv.style.opacity = "0";
            cardDiv.classList.add("animating-deal");
            forceReflow(cardDiv);

            setTimeout(() => {
                requestAnimationFrame(() => {
                    cardDiv.style.transform = "translate(0, 0) scale(1)";
                    cardDiv.style.opacity = "1";
                });
                onTransitionEnd(cardDiv, () => {
                    cardDiv.classList.remove("animating-deal");
                    cardDiv.style.transform = "";
                    cardDiv.style.opacity = "";
                    completed++;
                    if (completed === NUM_COLUMNS) finishDealAnim();
                }, 450);
            }, i * 50);
        });

        function finishDealAnim() {
            setAnimating(false);
            // 딜 후 각 열에서 완성 확인
            for (let c = 0; c < NUM_COLUMNS; c++) {
                checkCompleted(c);
            }
        }
    }

    // === 되돌리기 ===
    function undo() {
        if (state.animating) return;
        if (state.history.length === 0) return;

        const action = state.history.pop();

        if (action.type === "move") {
            const cards = state.columns[action.toCol].splice(-action.count);
            if (action.flipped) {
                const col = state.columns[action.fromCol];
                if (col.length > 0) col[col.length - 1].faceUp = false;
            }
            state.columns[action.fromCol].push(...cards);
            state.moves++;
            state.score = Math.max(0, state.score - 1);
        } else if (action.type === "deal") {
            for (let c = NUM_COLUMNS - 1; c >= 0; c--) {
                const card = state.columns[c].pop();
                card.faceUp = false;
                state.stock.push(card);
            }
        } else if (action.type === "complete") {
            // 완성 되돌리기
            state.completed.pop();
            const col = state.columns[action.col];
            if (col.length > 0) col[col.length - 1].faceUp = false;
            for (const card of action.cards) {
                card.faceUp = true;
            }
            state.columns[action.col].push(...action.cards);
            state.score -= 100;
        }

        clearSelection();
        updateInfo();
        render();
    }

    // === 승리 ===
    function showWin() {
        clearInterval(state.timerInterval);
        const m = Math.floor(state.timer / 60);
        const s = state.timer % 60;
        document.getElementById("win-message").innerHTML =
            `점수: <strong>${state.score}</strong><br>` +
            `이동: <strong>${state.moves}</strong>회<br>` +
            `시간: <strong>${m}분 ${s}초</strong>`;
        document.getElementById("win-modal").classList.add("active");
    }

    // === UI 렌더링 ===
    function render() {
        renderColumns();
        renderStock();
        renderCompleted();
    }

    function renderColumns() {
        const container = document.getElementById("columns");
        container.innerHTML = "";

        for (let c = 0; c < NUM_COLUMNS; c++) {
            const colDiv = document.createElement("div");
            colDiv.className = "column";
            colDiv.dataset.col = c;

            const cards = state.columns[c];
            const overlap = calculateOverlap(cards);

            let topOffset = 0;
            for (let i = 0; i < cards.length; i++) {
                const card = cards[i];
                const cardDiv = document.createElement("div");
                cardDiv.className = "card";
                cardDiv.style.top = topOffset + "px";
                cardDiv.style.zIndex = i;
                cardDiv.dataset.col = c;
                cardDiv.dataset.idx = i;

                if (card.faceUp) {
                    cardDiv.classList.add("face-up", SUIT_COLORS[card.suit]);

                    const topEl = document.createElement("div");
                    topEl.className = "card-top";
                    topEl.textContent = RANKS[card.rank] + SUIT_SYMBOLS[card.suit];

                    const suitEl = document.createElement("div");
                    suitEl.className = "card-suit";
                    suitEl.textContent = SUIT_SYMBOLS[card.suit];

                    cardDiv.appendChild(topEl);
                    cardDiv.appendChild(suitEl);

                    if (c === state.selectedCol && i >= state.selectedIdx) {
                        cardDiv.classList.add("selected");
                    }

                    cardDiv.addEventListener("click", () => onCardClick(c, i));
                } else {
                    cardDiv.classList.add("face-down");
                }

                colDiv.appendChild(cardDiv);
                topOffset += overlap[i] || 0;
            }

            // 빈 열 클릭
            if (cards.length === 0) {
                colDiv.style.minHeight = "120px";
                colDiv.style.background = "rgba(0,0,0,0.1)";
                colDiv.style.borderRadius = "6px";
                colDiv.style.border = "1px dashed rgba(255,255,255,0.2)";
            }

            colDiv.addEventListener("click", (e) => {
                if (e.target === colDiv) onEmptyColumnClick(c);
            });

            container.appendChild(colDiv);
        }
    }

    function calculateOverlap(cards) {
        const overlaps = [];
        for (let i = 0; i < cards.length; i++) {
            overlaps.push(cards[i].faceUp ? 24 : 8);
        }
        return overlaps;
    }

    function renderStock() {
        const area = document.getElementById("stock-area");
        area.innerHTML = "";
        const piles = Math.ceil(state.stock.length / NUM_COLUMNS);
        for (let i = 0; i < piles; i++) {
            const pile = document.createElement("div");
            pile.className = "stock-pile";
            pile.addEventListener("click", dealFromStock);
            area.appendChild(pile);
        }
    }

    function renderCompleted() {
        const area = document.getElementById("completed-area");
        area.innerHTML = "";
        for (const suit of state.completed) {
            const div = document.createElement("div");
            div.className = "completed-set";
            div.textContent = SUIT_SYMBOLS[suit];
            area.appendChild(div);
        }
    }

    function updateInfo() {
        document.getElementById("move-count").textContent = state.moves;
        document.getElementById("score").textContent = state.score;
    }

    // === 카드 클릭 처리 ===
    function onCardClick(col, idx) {
        if (state.animating) return;
        const card = state.columns[col][idx];
        if (!card.faceUp) return;

        if (state.selectedCol === -1) {
            // 선택
            if (canPickUp(col, idx)) {
                state.selectedCol = col;
                state.selectedIdx = idx;
                render();
            }
        } else if (state.selectedCol === col) {
            // 같은 열 클릭 → 선택 해제
            clearSelection();
            render();
        } else {
            // 다른 열로 이동 시도
            const movingCard = state.columns[state.selectedCol][state.selectedIdx];
            if (canPlace(col, movingCard)) {
                const fromCol = state.selectedCol;
                const fromIdx = state.selectedIdx;
                clearSelection();
                moveCards(fromCol, fromIdx, col);
            } else {
                // 이동 불가 → 새로운 선택 시도
                clearSelection();
                if (canPickUp(col, idx)) {
                    state.selectedCol = col;
                    state.selectedIdx = idx;
                }
                render();
            }
        }
    }

    function onEmptyColumnClick(col) {
        if (state.animating) return;
        if (state.selectedCol !== -1 && state.columns[col].length === 0) {
            const fromCol = state.selectedCol;
            const fromIdx = state.selectedIdx;
            clearSelection();
            moveCards(fromCol, fromIdx, col);
        }
    }

    function clearSelection() {
        state.selectedCol = -1;
        state.selectedIdx = -1;
    }

    // === 애니메이션 헬퍼 ===
    function setAnimating(on) {
        state.animating = on;
        const table = document.querySelector(".table-area");
        if (table) {
            if (on) table.classList.add("animating");
            else table.classList.remove("animating");
        }
    }

    function onTransitionEnd(el, callback, timeoutMs) {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            el.removeEventListener("transitionend", handler);
            callback();
        };
        const handler = () => finish();
        el.addEventListener("transitionend", handler);
        setTimeout(finish, timeoutMs || 400);
    }

    function forceReflow(el) {
        void el.offsetHeight;
    }

    function getCardRect(col, idx) {
        const colDiv = document.querySelectorAll("#columns .column")[col];
        if (!colDiv) return null;
        const cardDiv = colDiv.querySelectorAll(".card")[idx];
        if (!cardDiv) return null;
        return cardDiv.getBoundingClientRect();
    }

    function getStockRect() {
        const stockArea = document.getElementById("stock-area");
        const pile = stockArea && stockArea.querySelector(".stock-pile");
        if (pile) return pile.getBoundingClientRect();
        return stockArea ? stockArea.getBoundingClientRect() : null;
    }

    function getCompletedAreaRect() {
        const area = document.getElementById("completed-area");
        if (!area) return null;
        const rect = area.getBoundingClientRect();
        // 다음 완성 세트가 놓일 위치
        const sets = area.querySelectorAll(".completed-set");
        if (sets.length > 0) {
            const last = sets[sets.length - 1].getBoundingClientRect();
            return { top: last.top, left: last.right + 4, width: 36, height: 50 };
        }
        return { top: rect.top, left: rect.left, width: 36, height: 50 };
    }

    // === 화면 전환 ===
    function showScreen(id) {
        document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
        document.getElementById(id).classList.add("active");
    }

    // === 이벤트 바인딩 ===
    function init() {
        // 수트 선택
        document.querySelectorAll(".suit-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                const suits = parseInt(btn.dataset.suits);
                startGame(suits);
            });
        });

        // 헤더 버튼
        document.getElementById("btn-back").addEventListener("click", () => {
            clearInterval(state.timerInterval);
            showScreen("menu-screen");
        });

        document.getElementById("btn-undo").addEventListener("click", undo);

        document.getElementById("btn-new").addEventListener("click", () => {
            if (confirm("새 게임을 시작하시겠습니까?")) {
                startGame(state.numSuits);
            }
        });

        // 모달 버튼
        document.getElementById("btn-new-game").addEventListener("click", () => {
            document.getElementById("win-modal").classList.remove("active");
            startGame(state.numSuits);
        });

        document.getElementById("btn-menu").addEventListener("click", () => {
            document.getElementById("win-modal").classList.remove("active");
            showScreen("menu-screen");
        });

        // 키보드 단축키
        document.addEventListener("keydown", (e) => {
            if (e.ctrlKey && e.key === "z") {
                e.preventDefault();
                undo();
            }
        });
    }

    init();
})();
