let tg = window.Telegram.WebApp;
tg.expand(); // Разворачиваем на весь экран

// Инициализация переменных
let score = 0;
const scoreElement = document.getElementById('score');
const clickBtn = document.getElementById('click-btn');
const usernameElement = document.getElementById('username');

// Получаем имя пользователя из данных Telegram
if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
    usernameElement.innerText = tg.initDataUnsafe.user.first_name;
} else {
    usernameElement.innerText = "Аноним";
}

// Обработка клика
clickBtn.addEventListener('click', () => {
    // Увеличиваем счет
    score++;
    scoreElement.innerText = score;

    // Вибрация при клике (Haptic Feedback)
    tg.HapticFeedback.impactOccurred('light');

    // Анимация (опционально, можно добавить классы)
});

// Сохраняем прогресс (просто пример отправки данных)
// В реальном приложении это делалось бы через API
tg.MainButton.setText("Сохранить и выйти");
tg.MainButton.show();

tg.MainButton.onClick(() => {
    const data = JSON.stringify({ score: score });
    tg.sendData(data);
});
