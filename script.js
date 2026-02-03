let tg = window.Telegram.WebApp;
tg.expand();

// Глобальные данные
let user = {
    id: 0,
    coins: 0,
    tokens: 0,
    swords: [],
    spawners: {}, // {name: count}
    farm: [],
    enchantments: [],
    last_mining_collection: 0
};

let GAME_DATA = {
    spawners: {},
    swords: {},
    enchantments: {},
    farms: {},
    hoes: {}
};

// Инициализация
async function init() {
    // Получаем ID пользователя
    if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
        user.id = tg.initDataUnsafe.user.id;
    } else {
        // Для тестов в браузере без Telegram
        const urlParams = new URLSearchParams(window.location.search);
        user.id = urlParams.get('user_id') || 6732912874; // Fallback to admin ID or mock
    }

    console.log("User ID:", user.id);

    try {
        // 1. Загружаем игровые данные (константы)
        const gameDataResp = await fetch('/api/game_data');
        GAME_DATA = await gameDataResp.json();
        
        // 2. Загружаем данные пользователя
        await syncUserData();

        // 3. Рендерим интерфейс
        renderFarm();
        renderShop();
        renderMySpawners();
        renderSwords();
        renderHoes();
        renderEnchantments();
        updateBalanceUI();
        updateMiningUI();

        // 4. Запускаем циклы
        setInterval(gameLoop, 1000);
        setInterval(syncClicks, 5000); // Периодическая синхронизация кликов
        setInterval(updateMiningUI, 1000); // UI майнинга

    } catch (e) {
        console.error("Init error:", e);
        tg.showAlert("Ошибка загрузки данных: " + e.message);
    }
}

async function syncUserData() {
    const resp = await fetch(`/api/user/${user.id}`);
    const data = await resp.json();
    
    if (data.error) throw new Error(data.error);

    user.coins = data.coins;
    user.tokens = data.tokens;
    user.spawners = data.spawners || {};
    user.swords = data.swords || [];
    user.farm = data.farm_state || [];
    user.farm_cooldowns = data.farm_cooldowns || {};
    user.farm_progress = data.farm_progress || {};
    user.hoes = data.hoes || [];
    user.enchantments = data.enchantments || [];
    user.spawner_levels = data.spawner_levels || {};
    user.last_mining_collection = data.last_mining_collection || 0;
    
    // Инициализируем грядки если их нет (пока локально)
    if (user.farm.length === 0) {
        user.farm = [
            { id: 0, plant: null, plantedAt: null },
            { id: 1, plant: null, plantedAt: null },
            { id: 2, plant: null, plantedAt: null },
            { id: 3, plant: null, plantedAt: null },
            { id: 4, plant: null, plantedAt: null }
        ];
    }
}

// --- Кликер ---
let pendingClicks = 0;

document.getElementById('click-btn').addEventListener('click', (e) => {
    user.coins += 1;
    pendingClicks += 1;
    updateBalanceUI();
    
    showFloatingText(e.clientX, e.clientY, "+1");
    tg.HapticFeedback.impactOccurred('light');
});

async function syncClicks() {
    if (pendingClicks === 0) return;
    
    try {
        const resp = await fetch('/api/sync', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                user_id: user.id,
                earned_coins: pendingClicks
            })
        });
        const res = await resp.json();
        if (res.status === 'ok') {
            pendingClicks = 0;
            // user.coins = res.new_balance; // Можно обновить для точности, но может дёргаться
        }
    } catch (e) {
        console.error("Sync error:", e);
    }
}

function showFloatingText(x, y, text) {
    const el = document.createElement('div');
    el.innerText = text;
    el.style.position = 'absolute';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.color = '#ffd700';
    el.style.fontWeight = 'bold';
    el.style.pointerEvents = 'none';
    el.style.animation = 'floatUp 1s forwards';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1000);
}

// --- Ферма ---
let selectedSeed = null;

function renderFarm() {
    const container = document.getElementById('farm-tab-content');
    
    const grid = document.getElementById('farm-grid');
    grid.innerHTML = '';

    // Рендер семян (если еще не отрендерили)
    let seedsContainer = document.getElementById('seeds-container');
    if (!seedsContainer) {
        seedsContainer = document.createElement('div');
        seedsContainer.id = 'seeds-container';
        seedsContainer.className = 'seeds-container';
        grid.parentNode.insertBefore(seedsContainer, grid);
    }
    renderSeeds(seedsContainer);

    // Рендер грядок
    user.farm.forEach((slot, index) => {
        const el = document.createElement('div');
        el.className = 'farm-slot';
        
        if (slot.plant) {
            el.classList.add('planted');
            const plantInfo = GAME_DATA.farms[slot.plant] || {plant_emoji: "?"};
            
            // Таймер
            const growTime = (GAME_DATA.farms[slot.plant]?.grow_time || 10) * 1000;
            // Backend sends ms (current_time * 1000)
            const plantedAt = slot.planted_at || slot.plantedAt; 
            
            const elapsed = Date.now() - plantedAt;
            const remaining = Math.max(0, growTime - elapsed);
            const isReady = remaining <= 0;

            el.innerHTML = `
                <div class="plant-emoji">${plantInfo.plant_emoji}</div>
                <div class="timer" id="timer-${index}">${isReady ? "Готово!" : Math.ceil(remaining/1000)+"с"}</div>
            `;
            if (isReady) el.classList.add('ready');
            
            el.onclick = () => harvest(index);
        } else {
            el.innerHTML = `<div class="plant-emoji">🟫</div>`;
            el.onclick = () => plant(index);
        }
        
        grid.appendChild(el);
    });
}

function renderSeeds(container) {
    container.innerHTML = '';
    
    // Сортируем по цене (или как-то еще)
    Object.entries(GAME_DATA.farms).forEach(([key, farm]) => {
        const btn = document.createElement('div');
        btn.className = 'seed-item';
        if (selectedSeed === key) btn.classList.add('active');
        
        // Проверяем кулдаун
        const cooldownEnd = user.farm_cooldowns[key];
        const now = Date.now() / 1000;
        const isCooldown = cooldownEnd && cooldownEnd > now;
        
        // Прогресс
        const progress = user.farm_progress[key] || 0;

        btn.innerHTML = `
            <div class="seed-emoji">${farm.plant_emoji}</div>
            <div class="seed-info">
                <span>${farm.plant_name}</span>
                <span class="seed-progress">${progress}/20</span>
            </div>
        `;
        
        if (isCooldown) {
            btn.classList.add('cooldown');
            const minutes = Math.ceil((cooldownEnd - now) / 60);
            btn.innerHTML += `<div class="cooldown-overlay">${minutes}м</div>`;
            btn.onclick = () => tg.showAlert(`Ферма отдыхает. Ждите ${minutes} мин.`);
        } else {
            btn.onclick = () => {
                selectedSeed = key;
                renderSeeds(container); // перерисовка для подсветки
            };
        }

        container.appendChild(btn);
    });
}

async function plant(slotIndex) {
    if (!selectedSeed) {
        tg.showAlert("Выберите семена сверху!");
        return;
    }
    
    const farmInfo = GAME_DATA.farms[selectedSeed];
    const requiredHoe = farmInfo.hoe;
    
    // Проверяем мотыгу локально для быстрого фидбека
    // user.hoes массив строк
    if (!user.hoes.includes(requiredHoe)) {
        tg.showAlert(`Нужна ${requiredHoe}`);
        return;
    }

    tg.HapticFeedback.impactOccurred('light');
    
    try {
        const resp = await fetch('/api/farm/plant', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                user_id: user.id,
                slot_index: slotIndex,
                plant_type: selectedSeed
            })
        });
        const res = await resp.json();
        
        if (res.status === 'success') {
            user.farm = res.farm_state;
            renderFarm();
        } else {
            tg.showAlert(res.error);
        }
    } catch (e) {
        console.error(e);
        tg.showAlert("Ошибка сети");
    }
}

async function harvest(slotIndex) {
    const slot = user.farm[slotIndex];
    if (!slot.plant) return;

    tg.HapticFeedback.impactOccurred('medium');

    try {
        const resp = await fetch('/api/farm/harvest', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                user_id: user.id,
                slot_index: slotIndex
            })
        });
        const res = await resp.json();
        
        if (res.status === 'success') {
            user.coins = res.new_balance;
            user.farm = res.farm_state;
            user.farm_progress = res.farm_progress;
            user.farm_cooldowns = res.farm_cooldowns;
            
            updateBalanceUI();
            renderFarm();
            
            const earned = GAME_DATA.farms[res.harvested].price_per_plant;
            showFloatingText(window.innerWidth/2, window.innerHeight/2, `+${earned}`);
            
            if (res.limit_reached) {
                tg.showAlert(`Лимит 20 собран! ${res.harvested} на перерыве.`);
            }
        } else {
            tg.showAlert(res.error);
        }
    } catch (e) {
        console.error(e);
        tg.showAlert("Ошибка сети");
    }
}


// --- Магазин Спавнеров ---
function renderShop() {
    const list = document.getElementById('shop-list');
    list.innerHTML = '';

    // Преобразуем объект SPAWNERS в массив для сортировки по цене
    const sortedSpawners = Object.entries(GAME_DATA.spawners).sort((a, b) => a[1].price - b[1].price);

    sortedSpawners.forEach(([key, item]) => {
        const count = user.spawners[key] || 0;
        
        const el = document.createElement('div');
        el.className = 'shop-item';
        
        // Извлекаем эмодзи из ключа (первый символ) или названия
        const emoji = key.split(' ')[0]; 
        
        el.innerHTML = `
            <div class="shop-info">
                <h3>${key}</h3>
                <p>Доход: ${item.income_per_hour}/час</p>
                <p class="owned">У вас: ${count}</p>
            </div>
            <button class="buy-btn" onclick="buySpawner('${key}')">
                ${item.price === 0 ? 'Бесплатно' : item.price.toLocaleString() + ' 💰'}
            </button>
        `;
        list.appendChild(el);
    });
}

async function buySpawner(spawnerName) {
    const item = GAME_DATA.spawners[spawnerName];
    if (user.coins >= item.price) {
        tg.MainButton.showProgress();
        try {
            const resp = await fetch('/api/buy_spawner', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    user_id: user.id,
                    spawner_name: spawnerName
                })
            });
            const res = await resp.json();
            
            if (res.status === 'success') {
                user.coins = res.new_balance;
                user.spawners = res.spawners;
                
                updateBalanceUI();
                renderShop(); 
                renderMySpawners();
                tg.showAlert(`Куплен спавнер: ${spawnerName}`);
                tg.HapticFeedback.notificationOccurred('success');
            } else {
                tg.showAlert("Ошибка: " + res.error);
            }
        } catch (e) {
            tg.showAlert("Ошибка сети");
        }
        tg.MainButton.hideProgress();
    } else {
        tg.showAlert("Недостаточно монет!");
    }
}

function renderMySpawners() {
    const list = document.getElementById('my-spawners-list');
    if (!list) return;
    list.innerHTML = '';

    const mySpawners = Object.entries(user.spawners).filter(([_, count]) => count > 0);
    
    if (mySpawners.length === 0) {
        list.innerHTML = '<p style="padding: 10px; color: #888;">У вас пока нет спавнеров.</p>';
        return;
    }

    mySpawners.forEach(([key, count]) => {
        const item = GAME_DATA.spawners[key];
        if (!item) return;

        const level = user.spawner_levels[key] || 1;
        const basePrice = item.price === 0 ? 5000 : item.price;
        const upgradeCost = basePrice * level;
        
        // Calculate current income for this specific spawner type (per unit)
        const baseIncome = item.income_per_hour;
        const currentIncome = baseIncome * (1 + (level - 1) * 0.2);
        const nextIncome = baseIncome * (1 + (level) * 0.2);
        
        const el = document.createElement('div');
        el.className = 'shop-item';
        
        el.innerHTML = `
            <div class="shop-info">
                <h3>${key} (Ур. ${level})</h3>
                <p>Количество: ${count}</p>
                <p>Доход: ${Math.floor(currentIncome)}/ч <span style="color: #4cd964; font-size: 0.8em;">➜ ${Math.floor(nextIncome)}</span></p>
            </div>
            <button class="buy-btn" onclick="upgradeSpawner('${key}')">
                ⬆️ ${upgradeCost.toLocaleString()}
            </button>
        `;
        list.appendChild(el);
    });
}

async function upgradeSpawner(spawnerName) {
    tg.MainButton.showProgress();
    try {
        const resp = await fetch('/api/spawner/upgrade', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                user_id: user.id,
                spawner_name: spawnerName
            })
        });
        const res = await resp.json();
        
        if (res.status === 'success') {
            user.coins = res.new_balance;
            user.spawner_levels[spawnerName] = res.new_level;
            
            updateBalanceUI();
            renderMySpawners();
            updateMiningUI(); // Update total income display
            
            tg.showAlert(`Улучшено до уровня ${res.new_level}!`);
            tg.HapticFeedback.notificationOccurred('success');
        } else {
            tg.showAlert("Ошибка: " + res.error);
        }
    } catch (e) {
        tg.showAlert("Ошибка сети");
    }
    tg.MainButton.hideProgress();
}

// --- Оружейная (Мечи) ---
function renderSwords() {
    const list = document.getElementById('swords-list');
    list.innerHTML = '';

    const sortedSwords = Object.entries(GAME_DATA.swords).sort((a, b) => a[1].price - b[1].price);

    sortedSwords.forEach(([key, item]) => {
        const isOwned = user.swords.includes(key);
        const btnText = isOwned ? 'Куплено' : `${item.price.toLocaleString()} 💰`;
        const btnClass = isOwned ? 'buy-btn disabled' : 'buy-btn';
        const onClick = isOwned ? '' : `onclick="buySword('${key}')"`;

        const el = document.createElement('div');
        el.className = 'shop-item';
        el.innerHTML = `
            <div class="shop-info">
                <h3>${key}</h3>
                <p>Бонус к фарму: +${Math.round(item.farm_bonus * 100)}%</p>
            </div>
            <button class="${btnClass}" ${onClick}>
                ${btnText}
            </button>
        `;
        list.appendChild(el);
    });
}

async function buySword(swordName) {
    const item = GAME_DATA.swords[swordName];
    if (user.coins >= item.price) {
        tg.MainButton.showProgress();
        try {
            const resp = await fetch('/api/buy_sword', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    user_id: user.id,
                    sword_name: swordName
                })
            });
            const res = await resp.json();
            
            if (res.status === 'success') {
                user.coins = res.new_balance;
                user.swords = res.swords;
                
                updateBalanceUI();
                renderSwords();
                tg.showAlert(`Куплен меч: ${swordName}`);
                tg.HapticFeedback.notificationOccurred('success');
            } else {
                tg.showAlert("Ошибка: " + res.error);
            }
        } catch (e) {
            tg.showAlert("Ошибка сети");
        }
        tg.MainButton.hideProgress();
    } else {
        tg.showAlert("Недостаточно монет!");
    }
}


// --- Мотыги ---
function renderHoes() {
    const list = document.getElementById('hoes-list');
    if (!list) return;
    list.innerHTML = '';

    const sortedHoes = Object.entries(GAME_DATA.hoes).sort((a, b) => a[1].price - b[1].price);

    sortedHoes.forEach(([key, item]) => {
        const isOwned = user.hoes.includes(key);
        const btnText = isOwned ? 'Куплено' : `${item.price.toLocaleString()} 💰`;
        const btnClass = isOwned ? 'buy-btn disabled' : 'buy-btn';
        const onClick = isOwned ? '' : `onclick="buyHoe('${key}')"`;

        const el = document.createElement('div');
        el.className = 'shop-item small-item'; 
        el.style.minWidth = '200px'; // For horizontal scroll
        el.style.marginRight = '10px';
        
        el.innerHTML = `
            <div class="shop-info">
                <h3>${key}</h3>
                <p>Для: ${item.farm}</p>
            </div>
            <button class="${btnClass}" ${onClick}>
                ${btnText}
            </button>
        `;
        list.appendChild(el);
    });
}

async function buyHoe(hoeName) {
    const item = GAME_DATA.hoes[hoeName];
    if (user.coins >= item.price) {
        tg.MainButton.showProgress();
        try {
            const resp = await fetch('/api/buy_hoe', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    user_id: user.id,
                    hoe_name: hoeName
                })
            });
            const res = await resp.json();
            
            if (res.status === 'success') {
                user.coins = res.new_balance;
                user.hoes = res.hoes;
                
                updateBalanceUI();
                renderHoes();
                tg.showAlert(`Куплена: ${hoeName}`);
                tg.HapticFeedback.notificationOccurred('success');
            } else {
                tg.showAlert("Ошибка: " + res.error);
            }
        } catch (e) {
            tg.showAlert("Ошибка сети");
        }
        tg.MainButton.hideProgress();
    } else {
        tg.showAlert("Недостаточно монет!");
    }
}

// --- Зачарования ---
function renderEnchantments() {
    const list = document.getElementById('enchantments-list');
    if (!list) return;
    list.innerHTML = '';
    
    if (user.swords.length === 0) {
        list.innerHTML = '<p style="padding: 10px; color: #888;">Сначала купите меч!</p>';
        return;
    }

    user.swords.forEach(swordName => {
        const swordDiv = document.createElement('div');
        swordDiv.className = 'sword-enchant-group';
        swordDiv.style.marginBottom = '20px';
        swordDiv.innerHTML = `<h4 style="color: #ffd700; margin-bottom: 10px;">${swordName}</h4>`;
        
        Object.entries(GAME_DATA.enchantments).forEach(([enchName, item]) => {
            const hasEnch = user.enchantments.some(e => e.sword_name === swordName && e.enchantment === enchName);
            
            const btnText = hasEnch ? 'Установлено' : `${item.price.toLocaleString()} 💰`;
            const btnClass = hasEnch ? 'buy-btn disabled' : 'buy-btn';
            const onClick = hasEnch ? '' : `onclick="enchantSword('${swordName}', '${enchName}')"`;

            const el = document.createElement('div');
            el.className = 'shop-item';
            el.innerHTML = `
                <div class="shop-info">
                    <h5>${enchName}</h5>
                    <p>Бонус: +${Math.round(item.farm_bonus * 100)}% к доходу</p>
                </div>
                <button class="${btnClass}" ${onClick}>
                    ${btnText}
                </button>
            `;
            swordDiv.appendChild(el);
        });
        
        list.appendChild(swordDiv);
    });
}

async function enchantSword(swordName, enchName) {
    const item = GAME_DATA.enchantments[enchName];
    if (user.coins >= item.price) {
        tg.MainButton.showProgress();
        try {
            const resp = await fetch('/api/sword/enchant', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    user_id: user.id,
                    sword_name: swordName,
                    enchantment_name: enchName
                })
            });
            const res = await resp.json();
            
            if (res.status === 'success') {
                user.coins = res.new_balance;
                user.enchantments.push({sword_name: swordName, enchantment: enchName});
                
                updateBalanceUI();
                renderEnchantments();
                tg.showAlert(`Зачаровано: ${enchName}`);
                tg.HapticFeedback.notificationOccurred('success');
            } else {
                tg.showAlert("Ошибка: " + res.error);
            }
        } catch (e) {
            tg.showAlert("Ошибка сети");
        }
        tg.MainButton.hideProgress();
    } else {
        tg.showAlert("Недостаточно монет!");
    }
}

// --- Майнинг ---
function calculateIncomePerHour() {
    let totalIncome = 0;
    Object.entries(user.spawners).forEach(([name, count]) => {
        if (count > 0 && GAME_DATA.spawners[name]) {
            const base = GAME_DATA.spawners[name].income_per_hour;
            const level = user.spawner_levels[name] || 1;
            const spawnerIncome = base * (1 + (level - 1) * 0.2);
            totalIncome += spawnerIncome * count;
        }
    });

    // Bonuses
    let maxSwordBonus = 0;
    user.swords.forEach(s => {
        if (GAME_DATA.swords[s]) {
            const b = GAME_DATA.swords[s].farm_bonus;
            if (b > maxSwordBonus) maxSwordBonus = b;
        }
    });

    const enchBonus = user.enchantments.length * 0.05;
    const totalMultiplier = 1 + maxSwordBonus + enchBonus;
    
    return totalIncome * totalMultiplier;
}

function updateMiningUI() {
    const incomePerHour = calculateIncomePerHour();
    const incomePerSec = incomePerHour / 3600;
    
    document.getElementById('income-per-hour').innerText = Math.floor(incomePerHour).toLocaleString();
    
    // Accumulated
    if (user.last_mining_collection > 0) {
        const elapsed = (Date.now() / 1000) - user.last_mining_collection;
        const accumulated = Math.floor(elapsed * incomePerSec);
        document.getElementById('mining-accumulated').innerText = Math.max(0, accumulated).toLocaleString();
    } else {
        document.getElementById('mining-accumulated').innerText = "0";
    }
}

async function collectIncome() {
    tg.HapticFeedback.impactOccurred('medium');
    
    try {
        const resp = await fetch('/api/mining/collect', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                user_id: user.id
            })
        });
        const res = await resp.json();
        
        if (res.status === 'success') {
            const earned = res.earned;
            user.coins = res.new_balance;
            // Update last collection time locally to avoid jump
            user.last_mining_collection = Date.now() / 1000;
            
            updateBalanceUI();
            updateMiningUI();
            
            showFloatingText(window.innerWidth/2, window.innerHeight/2, `+${earned}`);
            tg.showAlert(`Собрано: ${earned}`);
        } else if (res.status === 'started') {
            tg.showAlert("Майнинг запущен!");
            user.last_mining_collection = Date.now() / 1000;
        } else {
            tg.showAlert(res.error);
        }
    } catch (e) {
        tg.showAlert("Ошибка сети");
    }
}

// --- Утилиты ---
function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));

    document.getElementById(`tab-${tabName}`).classList.add('active');
    // Находим кнопку (костыль, но работает)
    const btns = document.querySelectorAll('.nav-btn');
    if (tabName === 'clicker') btns[0].classList.add('active');
    if (tabName === 'farm') btns[1].classList.add('active');
    if (tabName === 'shop') btns[2].classList.add('active');
    if (tabName === 'swords') btns[3].classList.add('active');
}

function updateBalanceUI() {
    document.getElementById('balance').innerText = Math.floor(user.coins).toLocaleString();
    document.getElementById('tokens').innerText = user.tokens.toLocaleString();
}

function gameLoop() {
    // Обновляем таймеры на ферме
    user.farm.forEach((slot, index) => {
        if (slot.plant) {
            const timerEl = document.getElementById(`timer-${index}`);
            if (timerEl) {
                // Handle both snake_case (backend) and camelCase (local) just in case
                const plantedAt = slot.planted_at || slot.plantedAt;
                const growTime = (GAME_DATA.farms[slot.plant]?.grow_time || 10) * 1000;
                const elapsed = Date.now() - plantedAt;
                const remaining = Math.max(0, growTime - elapsed);
                
                if (remaining === 0) {
                    timerEl.innerText = "Готово!";
                    timerEl.style.color = "#4cd964";
                    // Добавляем класс ready родительскому элементу, если еще нет
                    if (!timerEl.parentElement.classList.contains('ready')) {
                        timerEl.parentElement.classList.add('ready');
                    }
                } else {
                    timerEl.innerText = Math.ceil(remaining / 1000) + "с";
                }
            }
        }
    });
}

// Запуск
init();
