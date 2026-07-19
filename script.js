document.addEventListener('DOMContentLoaded', () => {
    // Глобально отключаем вызов нативного меню браузера по долгому нажатию везде
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    const addButton = document.getElementById('add-book-btn');
    const fileInput = document.getElementById('file-input');

    // --- Инициализация Telegram WebApp ---
    const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
    if (tg) {
        tg.ready();
        tg.expand();
        
        // Подгружаем аватарку пользователя и имя, если они есть
        if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
            const user = tg.initDataUnsafe.user;
            
            // Получаем все элементы аватарок (кнопка сверху и внутри меню)
            const avatarImages = document.querySelectorAll('.avatar img');
            const dropdownTitle = document.querySelector('.dropdown-title');
            
            // Если у юзера есть фото, ставим его. Иначе генерируем по первой букве имени
            let avatarUrl = '';
            if (user.photo_url) {
                avatarUrl = user.photo_url;
            } else {
                const initials = (user.first_name || 'TG').substring(0, 2).toUpperCase();
                avatarUrl = `https://ui-avatars.com/api/?name=${initials}&background=333&color=fff&size=80`;
            }
            
            avatarImages.forEach(img => img.src = avatarUrl);
            
            if (dropdownTitle) {
                dropdownTitle.textContent = user.first_name || 'Профиль';
            }
        }
    }

    // --- Управление настройками ---
    const defaultSettings = {
        theme: 'dark',
        applyBgInActive: false,
        showProgress: true,
        lang: 'ru'
    };
    
    window.appSettings = JSON.parse(localStorage.getItem('SphereSettings')) || defaultSettings;
    


    const saveSettings = () => {
        localStorage.setItem('SphereSettings', JSON.stringify(window.appSettings));
        
        // Принудительно обновляем фон, если открыта вкладка Активные
        if (window.updateDynamicBackground && window.currentCarouselBook) {
            window.updateDynamicBackground(window.currentCarouselBook);
        }
    };

    window.updateDynamicBackground = (book) => {
        const dynamicBg = document.getElementById('dynamic-bg');
        if (!dynamicBg) return;
        
        // Показываем фон только если мы во вкладке "Активные" и настройка включена
        const isActiveTab = document.getElementById('btn-tab-active').classList.contains('active');
        
        if (window.appSettings.applyBgInActive && isActiveTab && book) {
            // Пытаемся вытащить src из coverHTML
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = book.coverHTML;
            const img = tempDiv.querySelector('img');
            
            if (img && img.src) {
                dynamicBg.style.backgroundImage = `url('${img.src}')`;
                dynamicBg.classList.add('show');
            } else {
                dynamicBg.classList.remove('show');
            }
        } else {
            dynamicBg.classList.remove('show');
        }
    };

    // --- Логика базы данных (IndexedDB) ---
    let db;
    const initDB = () => {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('SphereLibraryDB', 1);
            
            request.onupgradeneeded = (e) => {
                const database = e.target.result;
                if (!database.objectStoreNames.contains('books')) {
                    // Создаем хранилище книг с ключом id (по времени добавления)
                    database.createObjectStore('books', { keyPath: 'id' });
                }
            };
            
            request.onsuccess = (e) => {
                db = e.target.result;
                resolve(db);
            };
            
            request.onerror = (e) => reject(e.target.error);
        });
    };

    const saveBook = (bookObj) => {
        return new Promise((resolve, reject) => {
            const tx = db.transaction('books', 'readwrite');
            const store = tx.objectStore('books');
            const req = store.put(bookObj);
            req.onsuccess = () => {
                resolve();

            };
            req.onerror = (e) => reject(e.target.error);
        });
    };

    const getAllBooks = () => {
        return new Promise((resolve, reject) => {
            const tx = db.transaction('books', 'readonly');
            const store = tx.objectStore('books');
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = (e) => reject(e.target.error);
        });
    };

    const deleteBook = (id) => {
        return new Promise((resolve, reject) => {
            const tx = db.transaction('books', 'readwrite');
            const store = tx.objectStore('books');
            const req = store.delete(id);
            req.onsuccess = () => {
                resolve();

            };
            req.onerror = (e) => reject(e.target.error);
        });
    };

    const createLibraryCard = (book) => {
        const bookDiv = document.createElement('div');
        bookDiv.className = 'book-card';
        bookDiv.title = book.title;
        bookDiv.dataset.id = book.id;
        
        const fallbackCover = `
            <div class="fallback-cover">
                <svg viewBox="0 0 24 24" fill="none" stroke="hsl(0, 0%, 40%)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width: 32px; height: 32px; opacity: 0.5; margin-bottom: 8px; flex-shrink: 0;">
                    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path>
                </svg>
                <div class="fallback-cover-title">${book.title || 'Неизвестная книга'}</div>
                <div class="fallback-cover-author">${book.author || ''}</div>
            </div>
        `;
        const renderCover = book.coverHTML || fallbackCover;

        bookDiv.innerHTML = `
            <div class="book-cover">
                ${renderCover}
                <div class="long-press-overlay">
                    <div class="long-press-bar">
                        <div class="long-press-fill"></div>
                    </div>
                </div>
            </div>
            <div class="progress-container">
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${book.progress}%;"></div>
                </div>
                <span class="progress-text">${book.progress}%</span>
            </div>
        `;

        const coverDiv = bookDiv.querySelector('.book-cover');

        // Логика долгого нажатия и обычного клика
        let pressTimer;
        let showPressTimer; // Задержка перед показом полосы
        let isLongPress = false;
        const startPress = (e) => {
            if (e.type === 'mousedown' && e.button !== 0) return;
            isLongPress = false;
            
            // Проверяем, мобильное ли устройство
            const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
            const duration = isTouch ? 400 : 700; // 400ms на телефоне, 800ms на ПК
            
            // Передаем это время в CSS для правильной анимации
            bookDiv.style.setProperty('--press-duration', duration + 'ms');
            
            // Не показываем полосу сразу, даем 100мс задержку (если это быстрый клик, она даже не появится)
            showPressTimer = setTimeout(() => {
                bookDiv.classList.add('pressing');
            }, 100);
            
            pressTimer = setTimeout(() => {
                bookDiv.classList.remove('pressing');
                isLongPress = true; // Отмечаем, что сработал долгий тап
                if (window.openBookModal) {
                    window.openBookModal(book);
                }
            }, duration);
        };

        const cancelPress = () => {
            clearTimeout(showPressTimer);
            clearTimeout(pressTimer);
            bookDiv.classList.remove('pressing');
            coverDiv.style.transform = ''; // Сбрасываем 3D, возвращая управление CSS
        };

        bookDiv.addEventListener('mousedown', startPress);
        bookDiv.addEventListener('touchstart', startPress, {passive: true});
        bookDiv.addEventListener('mouseup', cancelPress);
        bookDiv.addEventListener('mouseleave', cancelPress);
        bookDiv.addEventListener('touchend', cancelPress);
        bookDiv.addEventListener('touchcancel', cancelPress);
        bookDiv.addEventListener('contextmenu', (e) => e.preventDefault());
        
        // Обычный клик открывает читалку
        bookDiv.addEventListener('click', (e) => {
            if (isLongPress) {
                e.preventDefault();
                return; // Игнорируем клик, если это был долгий тап
            }
            if (window.openBookReader) {
                window.openBookReader(book);
            }
        });

        return bookDiv;
    };

    const createActiveCard = (book) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'active-card-wrapper';
        
        const fallbackCover = `
            <div class="fallback-cover">
                <svg viewBox="0 0 24 24" fill="none" stroke="hsl(0, 0%, 40%)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width: 32px; height: 32px; opacity: 0.5; margin-bottom: 8px; flex-shrink: 0;">
                    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path>
                </svg>
                <div class="fallback-cover-title">${book.title || 'Неизвестная книга'}</div>
                <div class="fallback-cover-author">${book.author || ''}</div>
            </div>
        `;
        const renderCover = book.coverHTML || fallbackCover;

        wrapper.innerHTML = `
            <div class="active-card">
                ${renderCover}
            </div>
            <div class="active-progress-container">
                <div class="active-progress-fill" style="width: ${book.progress}%;"></div>
            </div>
        `;
        
        const card = wrapper.querySelector('.active-card');
        
        card.addEventListener('click', () => {
            if (window.openBookReader) {
                window.openBookReader(book);
            }
        });
        
        return wrapper;
    };

    const refreshLibraryUI = () => {
        getAllBooks().then((localBooks) => {
            const books = localBooks || [];
            const libraryGrid = document.getElementById('library-grid');
            const contentActive = document.getElementById('content-active');
            
            libraryGrid.innerHTML = '';
            contentActive.innerHTML = '';
            
            if (!books || books.length === 0) {
                document.getElementById('page-main').classList.remove('active');
                document.getElementById('page-welcome').classList.add('active');
                return;
            }
            
            // Инициализация класса видимости прогресса
            if (!window.appSettings.showProgress) {
                libraryGrid.classList.add('hide-progress');
            } else {
                libraryGrid.classList.remove('hide-progress');
            }
            
            document.getElementById('page-welcome').classList.remove('active');
            document.getElementById('page-main').classList.add('active');
            
            // Сортируем книги: сначала новые (обратный порядок)
            // Так как id - это строка (Date.now() + random), математическое вычитание давало NaN
            const sortedBooks = [...books].sort((a, b) => b.id.localeCompare(a.id));
            
            // Фильтруем активные книги (прогресс > 3% и < 100%)
            const activeBooks = sortedBooks.filter(b => b.progress > 3 && b.progress < 100);
            
            // 1. Отрисовка библиотеки
            sortedBooks.forEach(book => {
                libraryGrid.appendChild(createLibraryCard(book));
            });
            
            // 2. Отрисовка вкладки "Активные"
            if (activeBooks.length === 0) {
                contentActive.innerHTML = '<p class="empty-list-text">Нет активных книг</p>';
            } else {
                // Создаем карусель (viewport)
                const carousel = document.createElement('div');
                carousel.className = 'active-carousel';
                
                // Создаем трек, который будет двигаться
                const track = document.createElement('div');
                track.className = 'active-carousel-track';
                carousel.appendChild(track);
                
                // Создаем контейнер для точек
                const pagination = document.createElement('div');
                pagination.className = 'active-pagination';
                
                activeBooks.forEach((book, index) => {
                    track.appendChild(createActiveCard(book)); // Добавляем карточки в трек
                    
                    const dot = document.createElement('div');
                    dot.className = 'active-dot';
                    if (index === 0) dot.classList.add('active');
                    pagination.appendChild(dot);
                });
                
                contentActive.appendChild(carousel);
                contentActive.appendChild(pagination);
                
                const dots = pagination.querySelectorAll('.active-dot');
                const cards = track.querySelectorAll('.active-card-wrapper');
                let currentIndex = 0;
                
                // Функция для расчета смещения трека
                const getTranslate = (index) => -index * carousel.clientWidth;
                
                // Функция обновления карусели
                const updateCarousel = (smooth = true) => {
                    track.style.transition = smooth ? 'transform 0.5s cubic-bezier(0.25, 1, 0.5, 1)' : 'none';
                    track.style.transform = `translateX(${getTranslate(currentIndex)}px)`;
                    
                    dots.forEach((dot, index) => {
                        dot.classList.toggle('active', index === currentIndex);
                    });
                    
                    window.currentCarouselBook = activeBooks[currentIndex];
                    if (window.updateDynamicBackground) {
                        window.updateDynamicBackground(window.currentCarouselBook);
                    }
                };
                
                // Центрируем первую карточку сразу при загрузке
                updateCarousel(false);
                
                // Добавляем стрелки навигации для ПК (если книг больше одной)
                if (activeBooks.length > 1) {
                    const btnPrev = document.createElement('button');
                    btnPrev.className = 'active-nav-btn prev';
                    btnPrev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
                    
                    const btnNext = document.createElement('button');
                    btnNext.className = 'active-nav-btn next';
                    btnNext.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
                    
                    btnPrev.addEventListener('click', () => {
                        if (currentIndex > 0) {
                            currentIndex--;
                            updateCarousel();
                        }
                    });
                    
                    btnNext.addEventListener('click', () => {
                        if (currentIndex < activeBooks.length - 1) {
                            currentIndex++;
                            updateCarousel();
                        }
                    });
                    
                    contentActive.appendChild(btnPrev);
                    contentActive.appendChild(btnNext);
                }
                
                // Кастомная логика свайпа для мобильных
                let isDragging = false;
                let startX = 0;
                let startTranslate = 0;

                carousel.addEventListener('touchstart', (e) => {
                    isDragging = true;
                    startX = e.touches[0].clientX;
                    startTranslate = getTranslate(currentIndex);
                    track.style.transition = 'none'; // Отключаем плавность при перетаскивании
                }, { passive: true });

                carousel.addEventListener('touchmove', (e) => {
                    if (!isDragging) return;
                    const currentX = e.touches[0].clientX;
                    const diff = currentX - startX;
                    
                    let translate = startTranslate + diff;
                    
                    // Эффект пружины на краях
                    const maxTranslate = 0;
                    const minTranslate = -((activeBooks.length - 1) * carousel.clientWidth);
                    
                    if (translate > maxTranslate) {
                        const over = translate - maxTranslate;
                        translate = maxTranslate + over * 0.3; // Сопротивление пружины
                    } else if (translate < minTranslate) {
                        const over = minTranslate - translate;
                        translate = minTranslate - over * 0.3; // Сопротивление пружины
                    }
                    
                    track.style.transform = `translateX(${translate}px)`;
                }, { passive: true });

                carousel.addEventListener('touchend', (e) => {
                    if (!isDragging) return;
                    isDragging = false;
                    const endX = e.changedTouches[0].clientX;
                    const diff = endX - startX;
                    const wrapperWidth = carousel.clientWidth;
                    
                    // Если свайпнули больше чем на 15% ширины обложки ИЛИ достаточно быстро (но всегда 1 книга)
                    if (Math.abs(diff) > wrapperWidth * 0.15 || Math.abs(diff) > 30) {
                        if (diff > 0 && currentIndex > 0) {
                            currentIndex--; // Влево (предыдущая)
                        } else if (diff < 0 && currentIndex < activeBooks.length - 1) {
                            currentIndex++; // Вправо (следующая)
                        }
                    }
                    
                    updateCarousel(true); // Включаем плавную доводку
                }, { passive: true });
                
                // При ресайзе окна обновляем сброс анимации
                window.addEventListener('resize', () => updateCarousel(false));
            }
        });
    };

    // Глобальная переменная для отслеживания текущей открытой книги
    let currentReaderBook = null;

    // Инициализация БД и загрузка книг при старте
    initDB().then(() => {
        refreshLibraryUI();
    }).catch(e => console.error("Ошибка инициализации БД", e));



    // Клик по нашей круглой кнопке программно вызывает клик по скрытому input type="file"
    addButton.addEventListener('click', () => {
        // Проверяем, сенсорное ли это устройство (мобильный телефон)
        const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        
        // Для ПК открываем сразу (задержка 0), для телефона задержка уменьшена до 120ms
        const delay = isTouchDevice ? 120 : 0;
        
        setTimeout(() => {
            fileInput.click();
        }, delay);
    });

    // Когда пользователь выбрал файл
    fileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        
        if (file) {
            console.log('Выбран файл:', file.name);
            
            // Простейшая проверка расширения (только .fb2)
            if (file.name.toLowerCase().endsWith('.fb2')) {
                // Переключаем экраны: скрываем приветствие, показываем главную страницу
                document.getElementById('page-welcome').classList.remove('active');
                document.getElementById('page-main').classList.add('active');
                
                // Читаем файл как бинарные данные, чтобы определить кодировку
                const reader = new FileReader();
                reader.onload = (e) => {
                    const buffer = e.target.result;
                    
                    // Читаем первые 500 байт чтобы найти XML декларацию
                    const view = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 500));
                    let headerString = '';
                    for (let i = 0; i < view.length; i++) {
                        headerString += String.fromCharCode(view[i]);
                    }
                    
                    // Определяем кодировку (по умолчанию windows-1251 для русских fb2)
                    let encoding = 'windows-1251';
                    const encodingMatch = headerString.match(/encoding=['"](.*?)['"]/i);
                    if (encodingMatch && encodingMatch[1]) {
                        encoding = encodingMatch[1].toLowerCase();
                    }
                    
                    // Декодируем весь файл с правильной кодировкой
                    const decoder = new TextDecoder(encoding);
                    const fb2Content = decoder.decode(buffer);
                    
                    let coverBase64 = null;
                    let mimeType = 'image/jpeg'; // по умолчанию
                    
                    // 1. Ищем ID обложки
                    // Регулярка ищет <coverpage> и внутри него <image l:href="#cover.jpg"/>
                    const coverpageMatch = fb2Content.match(/<coverpage>.*?<image[^>]+(?:l:)?href="#([^"]+)".*?<\/coverpage>/is);
                    
                    if (coverpageMatch && coverpageMatch[1]) {
                        const coverId = coverpageMatch[1];
                        // 2. Ищем тег <binary> с этим ID
                        const binaryRegex = new RegExp(`<binary[^>]+id="${coverId}"[^>]*content-type="([^"]+)"[^>]*>(.*?)<\/binary>`, 'is');
                        const binaryMatch = fb2Content.match(binaryRegex);
                        if (binaryMatch) {
                            mimeType = binaryMatch[1];
                            coverBase64 = binaryMatch[2].trim();
                        }
                    }
                    
                    // Если не нашли через <coverpage>, пробуем просто найти первый попавшийся <binary> с картинкой
                    if (!coverBase64) {
                        const anyBinaryMatch = fb2Content.match(/<binary[^>]+content-type="(image\/[^"]+)"[^>]*>(.*?)<\/binary>/is);
                        if (anyBinaryMatch) {
                            mimeType = anyBinaryMatch[1];
                            coverBase64 = anyBinaryMatch[2].trim();
                        }
                    }

                    // 3. Парсинг метаданных книги
                    let title = "Неизвестная книга";
                    const titleMatch = fb2Content.match(/<book-title[^>]*>(.*?)<\/book-title>/is);
                    if (titleMatch) title = titleMatch[1].replace(/<[^>]+>/g, '').trim();

                    let author = "Неизвестный автор";
                    const authorMatch = fb2Content.match(/<author[^>]*>(.*?)<\/author>/is);
                    if (authorMatch) {
                        const firstMatch = authorMatch[1].match(/<first-name[^>]*>(.*?)<\/first-name>/is);
                        const lastMatch = authorMatch[1].match(/<last-name[^>]*>(.*?)<\/last-name>/is);
                        const first = firstMatch ? firstMatch[1].trim() : '';
                        const last = lastMatch ? lastMatch[1].trim() : '';
                        if (first || last) author = `${first} ${last}`.trim();
                    }

                    let genre = "Неизвестно";
                    const genreMatch = fb2Content.match(/<genre[^>]*>(.*?)<\/genre>/is);
                    if (genreMatch) genre = genreMatch[1].trim();

                    // Случайное число заметок для дизайна
                    let notesCount = Math.floor(Math.random() * 20);
                    
                    // Формируем HTML для обложки (картинка или заглушка)
                    let coverHTML = '';
                    if (coverBase64) {
                        coverHTML = `<img src="data:${mimeType};base64,${coverBase64}" alt="Обложка">`;
                    } else {
                        coverHTML = `
                            <svg viewBox="0 0 24 24" fill="none" stroke="hsl(0, 0%, 40%)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path>
                            </svg>
                        `;
                    }

                    // Новая книга всегда начинается с 0% прочитанного
                    const startProgress = 0;
                    
                    let bookObj = {
                        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                        title,
                        author,
                        genre,
                        notesCount,
                        coverHTML,
                        progress: startProgress,
                        fileData: fb2Content
                    };

                    // Если мы восстанавливаем облачную книгу (заглушку)
                    if (window.pendingCloudStub) {
                        bookObj.id = window.pendingCloudStub.id;
                        bookObj.progress = window.pendingCloudStub.progress || 0;
                        bookObj.lastRead = window.pendingCloudStub.lastRead || Date.now();
                        // Сохраняем исходные заметки, если они были (на будущее)
                        if (window.pendingCloudStub.notes) bookObj.notes = window.pendingCloudStub.notes;
                    }

                    saveBook(bookObj).then(() => {
                        refreshLibraryUI();
                        console.log(`Файл "${file.name}" сохранен в БД и добавлен в библиотеку.`);
                        
                        // Если это было восстановление облачной книги, сразу открываем её
                        if (window.pendingCloudStub) {
                            window.pendingCloudStub = null;
                            if (window.openBookReader) window.openBookReader(bookObj);
                        }
                    }).catch(e => console.error("Ошибка сохранения книги", e));
                };
                
                // Начинаем чтение файла как бинарный буфер (ArrayBuffer)
                reader.readAsArrayBuffer(file);
                
            } else {
                alert('Пожалуйста, выберите файл в формате .fb2');
            }
            
            // Очищаем значение, чтобы можно было выбрать этот же файл снова, если нужно
            fileInput.value = '';
        }
    });

    // --- Логика переключения вкладок (Активные / Библиотека) ---
    const btnActive = document.getElementById('btn-tab-active');
    const btnLibrary = document.getElementById('btn-tab-library');
    const contentActive = document.getElementById('content-active');
    const contentLibrary = document.getElementById('content-library');

    if (btnActive && btnLibrary) {
        btnActive.addEventListener('click', () => {
            // Переключаем стили кнопок
            btnActive.classList.add('active');
            btnLibrary.classList.remove('active');
            
            // Переключаем контент
            contentActive.classList.add('active');
            contentLibrary.classList.remove('active');
            
            if (window.updateDynamicBackground && window.currentCarouselBook) {
                window.updateDynamicBackground(window.currentCarouselBook);
            }
        });

        btnLibrary.addEventListener('click', () => {
            // Переключаем стили кнопок
            btnLibrary.classList.add('active');
            btnActive.classList.remove('active');
            
            // Переключаем контент
            contentLibrary.classList.add('active');
            contentActive.classList.remove('active');
            
            if (window.updateDynamicBackground) {
                window.updateDynamicBackground(null); // скрываем фон
            }
        });
    }

    // --- Логика выпадающего меню профиля ---
    const profileContainer = document.getElementById('profile-container');
    const avatarBtn = document.getElementById('avatar-btn');
    const profileDropdown = document.getElementById('profile-dropdown');
    const dropdownAddBook = document.getElementById('dropdown-add-book');

    if (profileContainer && avatarBtn && profileDropdown) {
        // Открытие/закрытие меню по клику на аватарку
        avatarBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Предотвращаем всплытие клика
            profileContainer.classList.toggle('open');
            profileDropdown.classList.toggle('open');
        });

        // Закрытие меню при клике вне его области (в любом другом месте экрана)
        document.addEventListener('click', (e) => {
            if (profileContainer.classList.contains('open') && !profileContainer.contains(e.target)) {
                profileContainer.classList.remove('open');
                profileDropdown.classList.remove('open');
            }
        });

        // Кнопка "Добавить книгу" внутри меню
        if (dropdownAddBook) {
            dropdownAddBook.addEventListener('click', () => {
                // Вызываем окно выбора файла синхронно (БЕЗ setTimeout!), 
                // иначе браузеры расценивают это как скрипт-спам и блокируют открытие окна
                fileInput.click();
                
                // Закрываем меню после вызова
                profileContainer.classList.remove('open');
                profileDropdown.classList.remove('open');
            });
        }
    }

    // --- Логика модального окна книги ---
    const modalBackdrop = document.getElementById('book-modal-backdrop');
    const modalTitle = document.getElementById('modal-title');
    const modalAuthor = document.getElementById('modal-author');
    const modalGenre = document.getElementById('modal-genre');
    const modalNotes = document.getElementById('modal-notes');
    const modalCoverWrapper = document.querySelector('.modal-cover-wrapper');
    const btnRead = document.getElementById('btn-read');
    const btnDelete = document.getElementById('btn-delete');

    if (modalBackdrop) {
        // Глобальная функция для открытия окна (используется при долгом нажатии)
        window.openBookModal = function(data) {
            modalTitle.textContent = data.title;
            modalAuthor.textContent = data.author;
            modalGenre.textContent = data.genre;
            if(modalNotes) modalNotes.textContent = data.notesCount;
            
            const fallbackCover = `
                <div class="fallback-cover">
                    <svg viewBox="0 0 24 24" fill="none" stroke="hsl(0, 0%, 40%)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width: 32px; height: 32px; opacity: 0.5; margin-bottom: 8px; flex-shrink: 0;">
                        <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path>
                    </svg>
                    <div class="fallback-cover-title">${data.title || 'Неизвестная книга'}</div>
                    <div class="fallback-cover-author">${data.author || ''}</div>
                </div>
            `;
            modalCoverWrapper.innerHTML = data.coverHTML || fallbackCover;
            
            // Сохраняем ID книги для возможного удаления и чтения
            if(btnDelete) btnDelete.dataset.currentBookId = data.id;
            if(btnRead) btnRead.dataset.currentBookId = data.id;
            
            modalBackdrop.classList.add('open');
        };

        // Закрытие по клику на затемненный фон
        modalBackdrop.addEventListener('click', (e) => {
            if (e.target === modalBackdrop) {
                modalBackdrop.classList.remove('open');
            }
        });

        // Заглушки для кнопок действий
        if (btnRead) {
            btnRead.addEventListener('click', async () => {
                modalBackdrop.classList.remove('open');
                const id = btnRead.dataset.currentBookId;
                if (!id) return;
                
                try {
                    const books = await getAllBooks();
                    const book = books.find(b => b.id === id);
                    if (!book) return;
                    
                    if (window.openBookReader) {
                        window.openBookReader(book);
                    }
                } catch(e) {
                    console.error("Ошибка при открытии книги:", e);
                }
            });
        }
        
        if (btnDelete) {
            const confirmBackdrop = document.getElementById('confirm-modal-backdrop');
            const btnConfirmCancel = document.getElementById('btn-confirm-cancel');
            const btnConfirmDelete = document.getElementById('btn-confirm-delete');

            btnDelete.addEventListener('click', () => {
                const id = btnDelete.dataset.currentBookId;
                if (id) {
                    // Открываем кастомное окно подтверждения
                    confirmBackdrop.classList.add('open');
                }
            });

            // Закрытие по фону
            confirmBackdrop.addEventListener('click', (e) => {
                if (e.target === confirmBackdrop) {
                    confirmBackdrop.classList.remove('open');
                }
            });

            // Кнопка Отмена
            btnConfirmCancel.addEventListener('click', () => {
                confirmBackdrop.classList.remove('open');
            });

            // Кнопка Удалить
            btnConfirmDelete.addEventListener('click', () => {
                const id = btnDelete.dataset.currentBookId;
                if (id) {
                    deleteBook(id).then(() => {
                        confirmBackdrop.classList.remove('open');
                        modalBackdrop.classList.remove('open');
                        refreshLibraryUI();
                    }).catch(e => console.error("Ошибка удаления книги:", e));
                }
            });
        }
    }
    
    // =========================================
    // ЛОГИКА ЧИТАЛКИ И ПАРСИНГ FB2
    // =========================================
    const readerContent = document.getElementById('reader-content');
    const progressText = document.getElementById('reader-progress-text');
    
    // Глобальная функция открытия читалки (используется при клике по обложке и по кнопке "Читать")
    window.openBookReader = function(book) {
        if (book.isCloudStub) {
            const message = 'Эта книга была загружена на другом устройстве. Пожалуйста, загрузите её здесь (выберите .fb2 файл), чтобы продолжить чтение.';
            const triggerFileInput = () => {
                window.pendingCloudStub = book;
                const fileInput = document.getElementById('file-input');
                if (fileInput) fileInput.click();
            };
            
            if (tg && tg.showAlert) {
                // Используем нативное всплывающее окно Telegram (без URL сайта)
                tg.showAlert(message, triggerFileInput);
            } else {
                alert(message);
                triggerFileInput();
            }
            return;
        }

        currentReaderBook = book;
        
        document.getElementById('page-main').classList.remove('active');
        document.getElementById('page-welcome').classList.remove('active');
        document.getElementById('page-reader').classList.add('active');
        
        // Скрываем нижнюю панель навигации на время загрузки и сбрасываем состояние оглавления
        const bottomBar = document.querySelector('.reader-bottom-bar');
        const floatingHeader = document.getElementById('toc-header-floating');
        const btnToc = document.getElementById('btn-toc');
        if (bottomBar) {
            bottomBar.classList.add('hidden');
            bottomBar.classList.remove('expanded');
        }
        if (floatingHeader) floatingHeader.classList.remove('expanded');
        if (btnToc) btnToc.classList.remove('active');
        
        // Показываем временно индикатор загрузки (центрируем по вертикали и горизонтали)
        readerContent.innerHTML = '<div style="display: flex; height: 100%; align-items: center; justify-content: center; color: hsl(0, 0%, 50%);">Загрузка текста...</div>';
        
        // Даем браузеру отрисовать переключение экранов (и убрать полосу), и только потом синхронно парсим тяжелый FB2
        setTimeout(() => {
            if (book.htmlContent) {
                readerContent.innerHTML = '<div class="reader-text-container hidden-text">' + book.htmlContent + '</div>';
                finalizeReaderRender(book);
            } else {
                renderFB2(book);
            }
        }, 50);
    };
    
    function renderFB2(book) {
        const xmlString = book.fileData;
        
        // 1. Извлекаем все <binary> картинки в словарь
        const imagesMap = {};
        const binaryRegex = /<binary\s+id="([^"]+)"\s+content-type="([^"]+)"[^>]*>(.*?)<\/binary>/gis;
        let match;
        while ((match = binaryRegex.exec(xmlString)) !== null) {
            const id = match[1];
            const mimeType = match[2];
            const base64 = match[3].trim();
            imagesMap[id] = `data:${mimeType};base64,${base64}`;
        }

        // 2. Удаляем секции <binary> до парсинга, чтобы избежать подвисаний DOMParser
        let cleanXml = xmlString.replace(/<binary.*?>.*?<\/binary>/gis, '');
        
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(cleanXml, "text/xml");
        
        // Ищем основной <body> (игнорируем <body> с name="notes", если они есть)
        const bodies = xmlDoc.getElementsByTagName('body');
        let mainBody = null;
        for (let i = 0; i < bodies.length; i++) {
            if (bodies[i].getAttribute('name') !== 'notes') {
                mainBody = bodies[i];
                break;
            }
        }
        if (!mainBody && bodies.length > 0) mainBody = bodies[0];
        
        if (mainBody) {
            readerContent.innerHTML = '<div class="reader-text-container hidden-text">' + parseFB2Node(mainBody, imagesMap) + '</div>';
        } else {
            readerContent.innerHTML = '<div class="reader-text-container hidden-text"><p>Не удалось прочитать текст книги.</p></div>';
        }
        
        
        finalizeReaderRender(book);
    }
    
    function finalizeReaderRender(book) {
        // Даем браузеру время отрендерить текст перед расчетом страниц и показом панели
        setTimeout(() => {
            // Восстанавливаем скролл (из прогресса 0-100%)
            const scrollHeight = readerContent.scrollHeight - readerContent.clientHeight;
            if (scrollHeight > 0 && book.progress > 0) {
                readerContent.scrollTop = (book.progress / 100) * scrollHeight;
            } else {
                readerContent.scrollTop = 0;
            }
            
            updateProgress();
            
            // Плавно выводим текст книги
            const textContainer = readerContent.querySelector('.reader-text-container');
            if (textContainer) {
                // ГЕНЕРАЦИЯ ОГЛАВЛЕНИЯ (TOC)
                const chapters = textContainer.querySelectorAll('h2');
                const tocList = document.getElementById('toc-list');
                if (tocList) {
                    tocList.innerHTML = ''; // Очищаем старое оглавление
                    
                    if (chapters.length > 0) {
                        chapters.forEach((h2, index) => {
                            h2.id = `chapter-${index}`; // Добавляем якорь
                            
                            const li = document.createElement('li');
                            // Убираем лишние теги из текста заголовка
                            li.textContent = h2.textContent.trim() || `Глава ${index + 1}`;
                            
                            li.addEventListener('click', () => {
                                // Плавный скролл к главе
                                readerContent.scrollTo({
                                    top: h2.offsetTop - 20,
                                    behavior: 'smooth'
                                });
                                // Сворачиваем оглавление после клика
                                const bottomBar = document.querySelector('.reader-bottom-bar');
                                const floatingHeader = document.getElementById('toc-header-floating');
                                const btnToc = document.getElementById('btn-toc');
                                if (bottomBar) bottomBar.classList.remove('expanded');
                                if (floatingHeader) floatingHeader.classList.remove('expanded');
                                if (btnToc) btnToc.classList.remove('active');
                            });
                            
                            tocList.appendChild(li);
                        });
                    } else {
                        // Если глав нет
                        const li = document.createElement('li');
                        li.textContent = "В этой книге нет оглавления";
                        li.className = "empty-toc";
                        tocList.appendChild(li);
                    }
                }
                
                // Рендер заметок
                if (window.renderNotesList) window.renderNotesList();
                
                // Небольшой хак: принудительно запрашиваем reflow, чтобы анимация точно сработала
                void textContainer.offsetWidth;
                textContainer.classList.remove('hidden-text');
            }
            
            // Плавно выводим нижнюю панель
            const bottomBar = document.querySelector('.reader-bottom-bar');
            if (bottomBar) bottomBar.classList.remove('hidden');
        }, 50);
    }

    function parseFB2Node(node, imagesMap) {
        let html = '';
        const children = node.childNodes;
        
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            
            if (child.nodeType === 3) { // Text node
                // Умные дефисы: заменяем двойные -- на длинное тире — (нужно для Neucha)
                let text = child.textContent;
                text = text.replace(/-{2,3}/g, '—');
                html += text;
            } else if (child.nodeType === 1) { // Element node
                const tag = child.tagName.toLowerCase();
                if (tag === 'p') {
                    html += '<p>' + parseFB2Node(child, imagesMap) + '</p>';
                } else if (tag === 'title') {
                    html += '<h2>' + parseFB2Node(child, imagesMap) + '</h2>';
                } else if (tag === 'subtitle') {
                    html += '<h3>' + parseFB2Node(child, imagesMap) + '</h3>';
                } else if (tag === 'strong') {
                    html += '<strong>' + parseFB2Node(child, imagesMap) + '</strong>';
                } else if (tag === 'emphasis') {
                    html += '<em>' + parseFB2Node(child, imagesMap) + '</em>';
                } else if (tag === 'empty-line') {
                    html += '<br><br>';
                } else if (tag === 'section') {
                    html += '<div class="section">' + parseFB2Node(child, imagesMap) + '</div>';
                } else if (tag === 'epigraph') {
                    html += '<blockquote class="epigraph">' + parseFB2Node(child, imagesMap) + '</blockquote>';
                } else if (tag === 'image') {
                    let href = child.getAttribute('l:href') || child.getAttribute('href') || child.getAttribute('xlink:href');
                    if (href && href.startsWith('#')) {
                        href = href.substring(1);
                    }
                    if (href && imagesMap && imagesMap[href]) {
                        html += `<div style="text-align: center; margin: 20px 0;"><img style="max-width: 100%; border-radius: 8px;" src="${imagesMap[href]}" alt="Иллюстрация"></div>`;
                    }
                } else {
                    html += parseFB2Node(child, imagesMap); // Пропускаем неизвестный тег, но парсим его детей
                }
            }
        }
        return html;
    }

    // --- Логика слайдера страниц ---
    let lastTotalPages = 0;
    let isSliderScrolling = false;
    let isReaderScrolling = false;
    let syncTimeout = null;
    const sliderContainer = document.getElementById('page-ticker-container');

    function buildPageSlider(totalPages) {
        if (!sliderContainer) return;
        
        sliderContainer.innerHTML = '';
        
        const spacerStart = document.createElement('div');
        spacerStart.className = 'page-ticker-spacer';
        sliderContainer.appendChild(spacerStart);
        
        for (let i = 1; i <= totalPages; i++) {
            const item = document.createElement('div');
            item.className = 'page-ticker-item';
            item.textContent = i;
            item.dataset.page = i;
            
            item.addEventListener('click', (e) => {
                if (window.sliderIsDragged) {
                    e.preventDefault();
                    return;
                }
                const scrollHeight = readerContent.scrollHeight - readerContent.clientHeight;
                const progress = totalPages > 1 ? (i - 1) / (totalPages - 1) : 0;
                
                isSliderScrolling = true;
                readerContent.scrollTo({
                    top: scrollHeight * progress,
                    behavior: 'smooth'
                });
                
                clearTimeout(syncTimeout);
                syncTimeout = setTimeout(() => isSliderScrolling = false, 500);
            });
            
            sliderContainer.appendChild(item);
        }
        
        const spacerEnd = document.createElement('div');
        spacerEnd.className = 'page-ticker-spacer';
        sliderContainer.appendChild(spacerEnd);
        
        lastTotalPages = totalPages;
    }

    function syncSliderToPage(page) {
        if (isSliderScrolling || !sliderContainer) return; 
        
        const items = sliderContainer.querySelectorAll('.page-ticker-item');
        items.forEach(item => {
            if (parseInt(item.dataset.page) === page) {
                item.classList.add('active');
                
                // Центрируем активный элемент в контейнере
                isReaderScrolling = true;
                const scrollLeftPos = item.offsetLeft - (sliderContainer.clientWidth / 2) + (item.offsetWidth / 2);
                sliderContainer.scrollLeft = scrollLeftPos;
                
                clearTimeout(syncTimeout);
                syncTimeout = setTimeout(() => isReaderScrolling = false, 100);
            } else {
                item.classList.remove('active');
            }
        });
    }

    if (sliderContainer) {
        // --- Драг для ПК (перетаскивание мышью) ---
        let isDown = false;
        let startX;
        let scrollLeft;
        window.sliderIsDragged = false;

        sliderContainer.addEventListener('mousedown', (e) => {
            isDown = true;
            window.sliderIsDragged = false;
            sliderContainer.style.cursor = 'grabbing';
            sliderContainer.style.scrollSnapType = 'none'; // Отключаем прилипание во время перетаскивания
            startX = e.pageX - sliderContainer.offsetLeft;
            scrollLeft = sliderContainer.scrollLeft;
        });

        const stopDrag = () => {
            if (!isDown) return;
            isDown = false;
            sliderContainer.style.cursor = 'grab';
            sliderContainer.style.scrollSnapType = 'x mandatory'; // Возвращаем прилипание
            
            // Сбрасываем флаг драга чуть позже, чтобы клик успел перехватиться
            setTimeout(() => {
                window.sliderIsDragged = false;
            }, 50);
        };

        sliderContainer.addEventListener('mouseleave', stopDrag);
        window.addEventListener('mouseup', stopDrag);

        sliderContainer.addEventListener('mousemove', (e) => {
            if (!isDown) return;
            e.preventDefault();
            const x = e.pageX - sliderContainer.offsetLeft;
            const walk = (x - startX) * 1; // Уменьшена скорость скролла для большей плавности (было 1.5)
            
            if (Math.abs(walk) > 5) {
                window.sliderIsDragged = true; // Считаем это драгом
            }
            
            sliderContainer.scrollLeft = scrollLeft - walk;
        });

        // Скролл колесиком мыши (транслируем вертикальный скролл в горизонтальный)
        sliderContainer.addEventListener('wheel', (e) => {
            e.preventDefault(); // Предотвращаем скролл страницы
            
            // Определяем, куда крутят (некоторые мышки имеют горизонтальный скролл)
            const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
            
            sliderContainer.scrollLeft += delta;
        }, { passive: false });

        // --- Обработка скролла (для синхронизации) ---
        sliderContainer.addEventListener('scroll', () => {
            if (isReaderScrolling) return;
            
            const centerPos = sliderContainer.scrollLeft + (sliderContainer.clientWidth / 2);
            let closestItem = null;
            let minDistance = Infinity;
            
            const items = sliderContainer.querySelectorAll('.page-ticker-item');
            items.forEach(item => {
                const itemCenter = item.offsetLeft + (item.offsetWidth / 2);
                const distance = Math.abs(itemCenter - centerPos);
                if (distance < minDistance) {
                    minDistance = distance;
                    closestItem = item;
                }
            });
            
            if (closestItem && !closestItem.classList.contains('active')) {
                items.forEach(i => i.classList.remove('active'));
                closestItem.classList.add('active');
                
                const page = parseInt(closestItem.dataset.page);
                const scrollHeight = readerContent.scrollHeight - readerContent.clientHeight;
                const total = lastTotalPages > 1 ? lastTotalPages - 1 : 1;
                const progress = (page - 1) / total;
                
                isSliderScrolling = true;
                readerContent.scrollTop = scrollHeight * progress;
                
                clearTimeout(syncTimeout);
                syncTimeout = setTimeout(() => isSliderScrolling = false, 100);
            }
        });
    }

    let autoSaveTimeout = null;
    
    function updateProgress() {
        const scrollHeight = readerContent.scrollHeight - readerContent.clientHeight;
        if (scrollHeight <= 0) {
            progressText.textContent = "1 / 1";
            if (lastTotalPages !== 1) buildPageSlider(1);
            syncSliderToPage(1);
            return;
        }
        const scrolled = readerContent.scrollTop;
        const progress = scrolled / scrollHeight;
        
        // Оценочное количество страниц (примерно 1 экран = 1 страница)
        const totalPages = Math.max(1, Math.ceil(readerContent.scrollHeight / readerContent.clientHeight));
        let currentPage = Math.min(totalPages, Math.max(1, Math.ceil(progress * totalPages)));
        
        // Небольшой хак: если мы докрутили до самого конца, показываем последнюю страницу
        if (scrolled >= scrollHeight - 5) {
            currentPage = totalPages;
        }
        
        progressText.textContent = `${currentPage} / ${totalPages}`;
        
        if (lastTotalPages !== totalPages) {
            buildPageSlider(totalPages);
        }
        
        syncSliderToPage(currentPage);
        
        // Обновляем прогресс текущей книги
        if (currentReaderBook) {
            currentReaderBook.progress = progress * 100;
            currentReaderBook.lastRead = Date.now();
            
            // Фоновое автосохранение через 2 секунды после остановки скролла
            clearTimeout(autoSaveTimeout);
            autoSaveTimeout = setTimeout(() => {
                if (typeof saveBook === 'function') {
                    saveBook(currentReaderBook).catch(e => console.error("Ошибка автосохранения:", e));
                }
            }, 2000);
        }
    }

    // Слушатель скролла (throttle через requestAnimationFrame для идеальных 60fps)
    let isScrollTicking = false;
    readerContent.addEventListener('scroll', () => {
        if (!isScrollTicking) {
            window.requestAnimationFrame(() => {
                updateProgress();
                isScrollTicking = false;
            });
            isScrollTicking = true;
        }
    });

    // Экстренное сохранение при закрытии или сворачивании Telegram Mini App
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && currentReaderBook) {
            if (typeof saveBook === 'function') {
                saveBook(currentReaderBook).catch(e => console.error(e));
            }
        }
    });

    if (progressText) {
        progressText.style.cursor = 'pointer'; // Добавляем курсор
        progressText.addEventListener('click', () => {
            const bottomBar = document.querySelector('.reader-bottom-bar');
            if (!bottomBar) return;
            
            // Если открыты заметки/оглавление - закрываем их
            if (bottomBar.classList.contains('expanded')) {
                bottomBar.classList.remove('expanded');
                document.querySelectorAll('.reader-nav-btn.active').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.toc-container.active').forEach(c => c.classList.remove('active'));
                document.querySelectorAll('.toc-header-floating.expanded').forEach(h => h.classList.remove('expanded'));
            }
            
            // Переключаем слайдер
            bottomBar.classList.toggle('slider-expanded');
            progressText.classList.toggle('slider-active');
            
            // Если открываем - центрируем текущую страницу
            if (bottomBar.classList.contains('slider-expanded')) {
                const scrollHeight = readerContent.scrollHeight - readerContent.clientHeight;
                const progress = scrollHeight > 0 ? readerContent.scrollTop / scrollHeight : 0;
                const totalPages = Math.max(1, Math.ceil(readerContent.scrollHeight / readerContent.clientHeight));
                const currentPage = Math.min(totalPages, Math.max(1, Math.ceil(progress * totalPages)));
                
                // Даем браузеру отрендерить display (снять display: none или visibility), затем скроллим
                setTimeout(() => syncSliderToPage(currentPage), 10);
            }
        });
    }

    // Кнопка Назад из читалки
    const btnReaderBack = document.getElementById('btn-reader-back');
    if (btnReaderBack) {
        btnReaderBack.addEventListener('click', () => {
            // СНАЧАЛА сохраняем прогресс (пока страница еще видима и у нее есть высота)
            if (currentReaderBook) {
                const scrollHeight = readerContent.scrollHeight - readerContent.clientHeight;
                let newProgress = 0;
                
                if (scrollHeight > 0) {
                    newProgress = Math.round((readerContent.scrollTop / scrollHeight) * 100);
                }
                
                // Ограничиваем от 0 до 100
                newProgress = Math.min(100, Math.max(0, newProgress));
                currentReaderBook.progress = newProgress;
                
                // Сохраняем в базу данных
                saveBook(currentReaderBook).then(() => {
                    // Обновляем весь UI, так как книга могла перейти в статус "Активные"
                    refreshLibraryUI();
                });
            }
            
            // ЗАТЕМ переключаем экраны и сбрасываем UI читалки
            document.getElementById('page-reader').classList.remove('active');
            document.getElementById('page-main').classList.add('active');
            
            // Жесткий сброс состояния всех меню, чтобы при повторном открытии книги не висели старые окна
            const bottomBar = document.querySelector('.reader-bottom-bar');
            if (bottomBar) {
                bottomBar.classList.remove('expanded', 'slider-expanded');
            }
            ['btn-toc', 'btn-notes', 'btn-reader-settings'].forEach(id => {
                const btn = document.getElementById(id);
                if (btn) btn.classList.remove('active');
            });
            ['toc-container', 'notes-container', 'reader-settings-container'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.remove('active');
            });
            ['toc-header-floating', 'notes-header-floating', 'reader-settings-header-floating'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.remove('expanded');
            });
        });
    }

    // --- Логика панелей (Оглавление / Заметки / Настройки) ---
    const btnToc = document.getElementById('btn-toc');
    const btnNotes = document.getElementById('btn-notes');
    const btnReaderSettings = document.getElementById('btn-reader-settings');
    const bottomBar = document.querySelector('.reader-bottom-bar');
    
    const tocContainer = document.getElementById('toc-container');
    const notesContainer = document.getElementById('notes-container');
    const settingsContainer = document.getElementById('reader-settings-container');
    
    const tocHeader = document.getElementById('toc-header-floating');
    const notesHeader = document.getElementById('notes-header-floating');
    const settingsHeader = document.getElementById('reader-settings-header-floating');
    
    const openPanel = (type) => {
        if (!bottomBar) return;
        
        const isAlreadyExpanded = bottomBar.classList.contains('expanded');
        const isCurrentActive = (type === 'toc' && btnToc && btnToc.classList.contains('active')) || 
                                (type === 'notes' && btnNotes && btnNotes.classList.contains('active')) ||
                                (type === 'settings' && btnReaderSettings && btnReaderSettings.classList.contains('active'));
        
        // Сбрасываем активные состояния у всех элементов
        if (btnToc) btnToc.classList.remove('active');
        if (btnNotes) btnNotes.classList.remove('active');
        if (btnReaderSettings) btnReaderSettings.classList.remove('active');
        
        if (tocContainer) tocContainer.classList.remove('active');
        if (notesContainer) notesContainer.classList.remove('active');
        if (settingsContainer) settingsContainer.classList.remove('active');
        
        if (tocHeader) tocHeader.classList.remove('expanded');
        if (notesHeader) notesHeader.classList.remove('expanded');
        if (settingsHeader) settingsHeader.classList.remove('expanded');
        
        // Закрываем слайдер страниц, если он был открыт
        if (bottomBar.classList.contains('slider-expanded')) {
            bottomBar.classList.remove('slider-expanded');
            if (progressText) progressText.classList.remove('slider-active');
        }
        
        if (isAlreadyExpanded && isCurrentActive) {
            // Кликнули по активной вкладке - закрываем капсулу
            bottomBar.classList.remove('expanded');
        } else {
            // Открываем новую вкладку
            bottomBar.classList.add('expanded');
            if (type === 'toc') {
                if (btnToc) btnToc.classList.add('active');
                if (tocContainer) tocContainer.classList.add('active');
                if (tocHeader) tocHeader.classList.add('expanded');
            } else if (type === 'notes') {
                if (btnNotes) btnNotes.classList.add('active');
                if (notesContainer) notesContainer.classList.add('active');
                if (notesHeader) notesHeader.classList.add('expanded');
            } else if (type === 'settings') {
                if (btnReaderSettings) btnReaderSettings.classList.add('active');
                if (settingsContainer) settingsContainer.classList.add('active');
                if (settingsHeader) settingsHeader.classList.add('expanded');
                
                // Пересчитываем позицию кольца темы, так как теперь контейнер видимый
                if (typeof window.updateReaderThemeRing === 'function') {
                    setTimeout(window.updateReaderThemeRing, 50);
                }
            }
        }
    };

    if (btnToc) btnToc.addEventListener('click', () => openPanel('toc'));
    if (btnNotes) btnNotes.addEventListener('click', () => openPanel('notes'));
    if (btnReaderSettings) btnReaderSettings.addEventListener('click', () => openPanel('settings'));
    const btnCleanScreen = document.getElementById('btn-clean-screen');
    if (btnCleanScreen) {
        btnCleanScreen.addEventListener('click', (e) => {
            e.stopPropagation();
            
            // Сбрасываем фокус с кнопки, чтобы случайное нажатие Space/Enter 
            // не вызывало повторный клик по кнопке с клавиатуры
            btnCleanScreen.blur();
            
            // Зажигаем иконку жёлтым
            btnCleanScreen.classList.add('active');
            
            if (bottomBar) {
                bottomBar.classList.add('hidden');
                
                // Принудительно скрываем кнопку сохранения заметки, если она была видима
                const btnSaveNoteFloat = document.getElementById('btn-save-note-float');
                if (btnSaveNoteFloat) btnSaveNoteFloat.classList.remove('visible');
                
                // Убираем жёлтый цвет после того как панель полностью скроется (850мс),
                // чтобы при следующем появлении она снова была обычной белой
                setTimeout(() => {
                    btnCleanScreen.classList.remove('active');
                }, 850);
            }
        });
    }

    // Закрываем панель при клике на текст книги
    if (readerContent && bottomBar) {
        readerContent.addEventListener('click', () => {
            if (bottomBar.classList.contains('hidden')) {
                // На ПК клик мышкой НЕ возвращает панель
                const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (navigator.msMaxTouchPoints > 0);
                if (!isTouchDevice) return; // Игнорируем клик мышью на ПК

                bottomBar.classList.remove('hidden');
                
                // Если пользователь быстро вернул меню до окончания таймера скрытия,
                // сразу принудительно гасим жёлтый цвет у кнопки
                if (btnCleanScreen) {
                    btnCleanScreen.classList.remove('active');
                }
                return;
            }
            if (bottomBar.classList.contains('expanded')) {
                bottomBar.classList.remove('expanded');
                if (tocHeader) tocHeader.classList.remove('expanded');
                if (notesHeader) notesHeader.classList.remove('expanded');
                if (settingsHeader) settingsHeader.classList.remove('expanded');
                if (btnToc) btnToc.classList.remove('active');
                if (btnNotes) btnNotes.classList.remove('active');
                if (btnReaderSettings) btnReaderSettings.classList.remove('active');
            }
            if (bottomBar.classList.contains('slider-expanded')) {
                bottomBar.classList.remove('slider-expanded');
                if (typeof progressText !== 'undefined' && progressText) progressText.classList.remove('slider-active');
            }
        });
    }

    // Обработка клавиатуры для ПК (выход из режима чистого экрана)
    document.addEventListener('keydown', (e) => {
        const bottomBar = document.querySelector('.reader-bottom-bar');
        const btnCleanScreen = document.getElementById('btn-clean-screen');
        
        if (!bottomBar || !bottomBar.classList.contains('hidden')) return;
        
        const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (navigator.msMaxTouchPoints > 0);
        if (!isTouchDevice) {
            // Разрешенные клавиши
            if (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape' || e.code === 'Backspace') {
                e.preventDefault(); // Запрещаем скролл вниз от пробела
                bottomBar.classList.remove('hidden');
                if (btnCleanScreen) btnCleanScreen.classList.remove('active');
            }
        }
    });

    // Глобальная функция рендера списка заметок
    window.renderNotesList = function() {
        const notesList = document.getElementById('notes-list');
        const book = currentReaderBook;
        if (!notesList || !book) return;
        
        notesList.innerHTML = '';
        if (book.notes && book.notes.length > 0) {
            book.notes.forEach((note, index) => {
                const li = document.createElement('li');
                li.innerHTML = `
                    <div style="flex-grow: 1; padding-right: 15px; font-size: 16px; color: rgba(255,255,255,1); line-height: 1.4; font-weight: 500;">
                        "${note.text}"
                    </div>
                    <button class="note-delete-btn" title="Удерживайте для удаления">
                        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        <svg class="progress-ring" width="40" height="40" viewBox="0 0 40 40">
                            <circle class="progress-ring-circle" stroke="#ff4a4a" stroke-width="4.2" fill="transparent" r="16" cx="20" cy="20" stroke-linecap="round"/>
                        </svg>
                    </button>
                `;
                li.style.display = 'flex';
                li.style.alignItems = 'center';
                li.style.justifyContent = 'space-between';
                li.style.cursor = 'pointer';
                
                const deleteBtn = li.querySelector('.note-delete-btn');
                let holdTimer;
                const HOLD_DURATION = 900; // Время удержания 0.9 секунд
                
                const deleteNote = () => {
                    // Этап 1: Уменьшаем и скрываем саму заметку на месте (чтобы не прыгала вверх)
                    li.style.transition = 'transform 0.2s cubic-bezier(0.55, 0.085, 0.68, 0.53), opacity 0.15s ease';
                    li.style.transform = 'scale(0.8)';
                    li.style.opacity = '0';
                    li.style.pointerEvents = 'none';
                    
                    // Ждем пока она визуально исчезнет (200мс)
                    setTimeout(() => {
                        // Этап 2: Плавно схлопываем пустое место по высоте
                        const currentHeight = li.offsetHeight;
                        li.style.transition = 'none';
                        li.style.height = currentHeight + 'px';
                        li.style.overflow = 'hidden';
                        void li.offsetHeight; // Принудительный reflow
                        
                        li.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
                        li.style.height = '0';
                        li.style.paddingTop = '0';
                        li.style.paddingBottom = '0';
                        li.style.marginTop = '0';
                        li.style.marginBottom = '0';
                        li.style.border = 'none';
                        
                        // Этап 3: Ждем завершения схлопывания (300мс) и реально удаляем данные
                        setTimeout(() => {
                            // Удаляем заметку из массива
                            book.notes.splice(index, 1);
                            
                            // Убираем маркер из текста (unwrap)
                            const mark = document.getElementById(note.id);
                            if (mark) {
                                const parent = mark.parentNode;
                                while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
                                parent.removeChild(mark);
                                
                                const textContainer = document.querySelector('.reader-text-container');
                                if (textContainer) book.htmlContent = textContainer.innerHTML;
                            }
                            
                            // Сохраняем в базу и ререндерим список (он уже отрисуется без этой заметки)
                            if (typeof saveBook === 'function') {
                                saveBook(book).then(() => {
                                    if (window.renderNotesList) window.renderNotesList();
                                });
                            }
                        }, 300);
                    }, 200);
                };
                
                const startHold = (e) => {
                    // Предотвращаем скролл/выделение текста на мобилках при зажатии
                    if (e.cancelable) e.preventDefault(); 
                    e.stopPropagation(); // Не скроллим к заметке
                    deleteBtn.classList.add('holding');
                    
                    holdTimer = setTimeout(() => {
                        deleteNote();
                    }, HOLD_DURATION);
                };
                
                const endHold = (e) => {
                    if (e) e.stopPropagation();
                    // Если удаление уже началось, не откатываем визуальное состояние
                    if (deleteBtn.classList.contains('deleting')) return;
                    deleteBtn.classList.remove('holding');
                    clearTimeout(holdTimer);
                };

                // События мыши
                deleteBtn.addEventListener('mousedown', startHold);
                deleteBtn.addEventListener('mouseup', endHold);
                deleteBtn.addEventListener('mouseleave', endHold);
                deleteBtn.addEventListener('click', (e) => e.stopPropagation()); // блокируем обычный клик
                
                // Сенсорные события
                deleteBtn.addEventListener('touchstart', startHold, {passive: false});
                deleteBtn.addEventListener('touchend', endHold, {passive: false});
                deleteBtn.addEventListener('touchcancel', endHold, {passive: false});
                
                // Переход к заметке по клику на область карточки
                li.addEventListener('click', () => {
                    const mark = document.getElementById(note.id);
                    const readerContent = document.getElementById('reader-content');
                    if (mark && readerContent) {
                        readerContent.scrollTo({
                            top: mark.offsetTop - 150,
                            behavior: 'smooth'
                        });
                        
                        // Скрываем нижнее меню после клика
                        const bottomBar = document.querySelector('.reader-bottom-bar');
                        const floatingHeader = document.getElementById('notes-header-floating');
                        const btnNotes = document.getElementById('btn-notes');
                        if (bottomBar) bottomBar.classList.remove('expanded');
                        if (floatingHeader) floatingHeader.classList.remove('expanded');
                        if (btnNotes) btnNotes.classList.remove('active');
                    }
                });
                
                notesList.appendChild(li);
            });
        } else {
            const li = document.createElement('li');
            li.textContent = "Нет заметок";
            li.className = "empty-toc";
            notesList.appendChild(li);
        }
    };

    // --- Логика выделения текста и кнопки "Сохранить заметку" ---
    const btnSaveNoteFloat = document.getElementById('btn-save-note-float');
    
    // Обработка выделения текста
    document.addEventListener('selectionchange', () => {
        // Проверяем, что мы находимся в читалке
        if (!document.getElementById('page-reader').classList.contains('active')) return;
        
        const selection = window.getSelection();
        const text = selection.toString().trim();
        
        const bottomBar = document.querySelector('.reader-bottom-bar');
        const isZenMode = bottomBar && bottomBar.classList.contains('hidden');
        
        if (text.length > 5 && !isZenMode) {
            // Текст выделен и мы НЕ в чистом экране - показываем кнопку и подсвечиваем карандаш
            if (btnSaveNoteFloat) btnSaveNoteFloat.classList.add('visible');
            if (btnNotes) btnNotes.classList.add('highlight-active');
        } else {
            // Выделение снято или включен чистый экран - прячем
            if (btnSaveNoteFloat) btnSaveNoteFloat.classList.remove('visible');
            if (btnNotes) btnNotes.classList.remove('highlight-active');
        }
    });

    // Клик по кнопке "Сохранить заметку"
    if (btnSaveNoteFloat) {
        btnSaveNoteFloat.addEventListener('click', () => {
            const selection = window.getSelection();
            if (selection.rangeCount > 0 && selection.toString().trim().length > 5) {
                const range = selection.getRangeAt(0);
                const noteId = 'note-' + Date.now();
                
                // Оборачиваем выделение в оранжевый маркер
                try {
                    const mark = document.createElement('mark');
                    mark.className = 'highlight-orange';
                    mark.id = noteId;
                    mark.appendChild(range.extractContents());
                    range.insertNode(mark);
                    
                    if (currentReaderBook) {
                        if (!currentReaderBook.notes) currentReaderBook.notes = [];
                        currentReaderBook.notes.push({
                            id: noteId,
                            text: mark.textContent.trim(),
                            progress: currentReaderBook.progress || 0
                        });
                        
                        // Сохраняем сгенерированный HTML, чтобы маркеры и якоря не пропадали после перезагрузки
                        const textContainer = document.querySelector('.reader-text-container');
                        if (textContainer) {
                            currentReaderBook.htmlContent = textContainer.innerHTML;
                        }
                        
                        // Пишем в базу
                        if (typeof saveBook === 'function') {
                            saveBook(currentReaderBook).then(() => {
                                if (window.renderNotesList) window.renderNotesList();
                            });
                        }
                    }
                } catch (e) {
                    console.error("Ошибка при выделении текста:", e);
                }
                
                // Снимаем выделение и прячем UI
                selection.removeAllRanges();
                btnSaveNoteFloat.classList.remove('visible');
                if (btnNotes) btnNotes.classList.remove('highlight-active');
            }
        });
    }

    // ==========================================
    // ЛОГИКА ОКНА НАСТРОЕК
    // ==========================================
    const btnSettings = document.getElementById('btn-settings');
    const settingsBackdrop = document.getElementById('settings-modal-backdrop');
    const settingsModal = settingsBackdrop ? settingsBackdrop.querySelector('.settings-modal') : null;

    if (btnSettings && settingsBackdrop) {
        // Открытие настроек
        btnSettings.addEventListener('click', () => {
            settingsBackdrop.classList.add('open');
        });

        // Закрытие по клику вне модалки
        settingsBackdrop.addEventListener('click', (e) => {
            if (e.target === settingsBackdrop) {
                settingsBackdrop.classList.remove('open');
            }
        });

        // Блокируем закрытие при клике внутри самой модалки
        if (settingsModal) {
            settingsModal.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }

        // Функция для вычисления позиции кольца
        const updateRingPosition = (option, ring, color) => {
            if (!ring || !option) return;
            const box = option.querySelector('.theme-box');
            if (!box) return;
            
            // Используем offsetLeft/offsetTop, так как они полностью игнорируют CSS-трансформации
            // всего модального окна (scale 0.6), которые ломали вычисления getBoundingClientRect.
            const x = option.offsetLeft + box.offsetLeft - 2;
            const y = option.offsetTop + box.offsetTop - 2;
            
            ring.style.transform = `translate(${x}px, ${y}px)`;
            if (color) ring.style.borderColor = color;
        };

        // Логика выбора темы
        const themeOptions = settingsModal ? settingsModal.querySelectorAll('.theme-option') : [];
        const themeRing = settingsModal ? settingsModal.querySelector('.theme-selection-ring') : null;
        const ringColors = ['#ffffff', '#f4ecd8', '#141414'];
        
        themeOptions.forEach((option, index) => {
            if (option.classList.contains('active')) {
                // Инициализация без анимации
                if (themeRing) {
                    themeRing.style.transition = 'none';
                    updateRingPosition(option, themeRing, ringColors[index]);
                    setTimeout(() => {
                        themeRing.style.transition = 'transform 0.6s cubic-bezier(0.34, 1.35, 0.64, 1), border-color 0.4s ease';
                    }, 50);
                }
            }
            
            option.addEventListener('click', () => {
                themeOptions.forEach(opt => opt.classList.remove('active'));
                option.classList.add('active');
                
                if (themeRing) updateRingPosition(option, themeRing, ringColors[index]);
                
                // Перехватываем название темы
                let themeId = option.id.replace('theme-', '');
                if (themeId === 'light' || themeId === 'sepia' || themeId === 'dark') {
                    window.appSettings.theme = themeId;
                    applyTheme(themeId);
                    saveSettings();
                }
            });
        });
        
        // Обновляем позицию кольца при перевороте или изменении размера экрана
        window.addEventListener('resize', () => {
            const activeOption = settingsModal ? settingsModal.querySelector('.theme-option.active') : null;
            if (activeOption && themeRing) {
                themeRing.style.transition = 'none';
                updateRingPosition(activeOption, themeRing);
                setTimeout(() => {
                    themeRing.style.transition = 'transform 0.6s cubic-bezier(0.34, 1.35, 0.64, 1), border-color 0.4s ease';
                }, 50);
            }
        });

        // Инициализация UI настроек при загрузке
        const toggleBg = document.getElementById('toggle-bg');
        const toggleProgress = document.getElementById('toggle-progress');
        
        if (toggleBg) toggleBg.classList.toggle('active', window.appSettings.applyBgInActive);
        if (toggleProgress) toggleProgress.classList.toggle('active', window.appSettings.showProgress);

        // Логика переключателей (чекбоксов)
        const toggles = document.querySelectorAll('.checkbox-btn');
        toggles.forEach(toggle => {
            toggle.addEventListener('click', () => {
                const isActive = toggle.classList.toggle('active');
                
                if (toggle.id === 'toggle-bg') {
                    window.appSettings.applyBgInActive = isActive;
                } else if (toggle.id === 'toggle-progress') {
                    window.appSettings.showProgress = isActive;
                    const grid = document.getElementById('library-grid');
                    if (grid) {
                        if (isActive) grid.classList.remove('hide-progress');
                        else grid.classList.add('hide-progress');
                    }
                }
                
                // Функция saveSettings() определена вверху и вызовет обновление фона
                if (typeof saveSettings === 'function') {
                    saveSettings();
                }
            });
        });

        // Логика выбора языка
        const langBtns = document.querySelectorAll('.lang-btn');
        langBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                langBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
    }

    // ==========================================
    // ЛОГИКА ОКНА НАСТРОЕК ЧИТАЛКИ
    // ==========================================
    const readerThemeOptions = document.querySelectorAll('.reader-theme-option');
    const readerThemeRing = document.getElementById('reader-theme-ring');
    // Цвета окантовки: Light, Sepia, Dark, Night, Console, Adaptation
    const readerRingColors = ['#ffffff', '#f4ecd8', '#141414', '#0f172a', '#4ade80', '#888888'];
    
    window.updateReaderThemeRing = () => {
        const activeReaderTheme = document.querySelector('.reader-theme-option.active');
        if (activeReaderTheme && readerThemeRing) {
            readerThemeRing.style.transition = 'none';
            
            const box = activeReaderTheme.querySelector('.theme-box');
            if (box) {
                // Временно отключаем transform для точных измерений
                const originalTransform = activeReaderTheme.style.transform;
                activeReaderTheme.style.transform = 'none';
                
                const container = readerThemeRing.parentElement;
                const containerRect = container.getBoundingClientRect();
                const boxRect = box.getBoundingClientRect();
                
                activeReaderTheme.style.transform = originalTransform;
                
                const x = boxRect.left - containerRect.left - 2;
                const y = boxRect.top - containerRect.top - 2;
                readerThemeRing.style.transform = `translate(${x}px, ${y}px)`;
            }
            
            const index = Array.from(readerThemeOptions).indexOf(activeReaderTheme);
            if (index !== -1) readerThemeRing.style.borderColor = readerRingColors[index];
            setTimeout(() => {
                readerThemeRing.style.transition = 'transform 0.6s cubic-bezier(0.34, 1.35, 0.64, 1), border-color 0.4s ease';
            }, 50);
        }
    };
    
    // Инициализация при открытии или загрузке
    setTimeout(window.updateReaderThemeRing, 100);

    readerThemeOptions.forEach((option, index) => {
        option.addEventListener('click', () => {
            readerThemeOptions.forEach(opt => opt.classList.remove('active'));
            option.classList.add('active');
            
            if (readerThemeRing) {
                const box = option.querySelector('.theme-box');
                const x = option.offsetLeft + (box ? box.offsetLeft : 0);
                const y = option.offsetTop + (box ? box.offsetTop : 0);
                readerThemeRing.style.transform = `translate(${x - 2}px, ${y - 2}px)`;
                readerThemeRing.style.borderColor = readerRingColors[index];
            }
            
            // Здесь в будущем будет вызов функции смены темы для читалки
            // например: setReaderTheme(option.dataset.theme);
        });
    });

    // Обработка ресайза для кольца в читалке
    window.addEventListener('resize', window.updateReaderThemeRing);

    // ==========================================
    // ЛОГИКА ПОЛЗУНКОВ (ТИПОГРАФИКА)
    // ==========================================
    // Функция для применения стилей шрифта с сохранением позиции скролла
    function applyWithScrollPreservation(cssVar, value) {
        const readerContent = document.getElementById('reader-content');
        if (!readerContent) {
            document.documentElement.style.setProperty(cssVar, value);
            return;
        }

        const containerRect = readerContent.getBoundingClientRect();
        const sections = readerContent.querySelectorAll('.section');
        let targetSection = null;
        let offsetPercent = 0;

        for (let i = 0; i < sections.length; i++) {
            const rect = sections[i].getBoundingClientRect();
            if (rect.top < containerRect.bottom && rect.bottom > containerRect.top) {
                targetSection = sections[i];
                const pxHidden = containerRect.top - rect.top;
                offsetPercent = pxHidden / Math.max(1, rect.height);
                break;
            }
        }

        document.documentElement.style.setProperty(cssVar, value);
        void readerContent.scrollHeight; 

        if (targetSection) {
            const newRect = targetSection.getBoundingClientRect();
            const targetPxHidden = newRect.height * offsetPercent;
            const currentPxHidden = containerRect.top - newRect.top;
            readerContent.scrollTop += (targetPxHidden - currentPxHidden);
        }
    }

    const fontSizeSlider = document.getElementById('slider-font-size');
    const valFontSize = document.getElementById('val-font-size');
    if (fontSizeSlider && valFontSize) {
        fontSizeSlider.addEventListener('input', (e) => {
            const size = Math.round(e.target.value / 2) * 2;
            valFontSize.textContent = `${size}px`;
            applyWithScrollPreservation('--reader-font-size', `${size}px`);
        });
    }

    const btnFwNormal = document.getElementById('btn-fw-normal');
    const btnFwBold = document.getElementById('btn-fw-bold');
    const btnFsNormal = document.getElementById('btn-fs-normal');
    const btnFsItalic = document.getElementById('btn-fs-italic');

    if (btnFwNormal && btnFwBold && btnFsNormal && btnFsItalic) {
        btnFwNormal.addEventListener('click', (e) => {
            e.stopPropagation();
            btnFwNormal.classList.add('active');
            btnFwBold.classList.remove('active');
            document.getElementById('ctrl-font-weight').classList.remove('active-right');
            applyWithScrollPreservation('--reader-font-weight', 400);
        });
        btnFwBold.addEventListener('click', (e) => {
            e.stopPropagation();
            btnFwBold.classList.add('active');
            btnFwNormal.classList.remove('active');
            document.getElementById('ctrl-font-weight').classList.add('active-right');
            applyWithScrollPreservation('--reader-font-weight', 600);
        });
        btnFsNormal.addEventListener('click', (e) => {
            e.stopPropagation();
            btnFsNormal.classList.add('active');
            btnFsItalic.classList.remove('active');
            document.getElementById('ctrl-font-style').classList.remove('active-right');
            applyWithScrollPreservation('--reader-font-style', 'normal');
        });
        btnFsItalic.addEventListener('click', (e) => {
            e.stopPropagation();
            btnFsItalic.classList.add('active');
            btnFsNormal.classList.remove('active');
            document.getElementById('ctrl-font-style').classList.add('active-right');
            applyWithScrollPreservation('--reader-font-style', 'italic');
        });
    }

    const lineHeightSlider = document.getElementById('slider-line-height');
    const valLineHeight = document.getElementById('val-line-height');
    if (lineHeightSlider && valLineHeight) {
        lineHeightSlider.addEventListener('input', (e) => {
            const height = (Math.round(e.target.value * 10) / 10).toFixed(1);
            valLineHeight.textContent = height;
            applyWithScrollPreservation('--reader-line-height', height);
        });
    }

    // ==========================================
    // ЛОГИКА ВСТРОЕННОГО ВЫБОРА ШРИФТОВ
    // ==========================================
    const inlineFontSelector = document.getElementById('inline-font-selector');
    const btnFontPrev = document.getElementById('btn-font-prev');
    const btnFontNext = document.getElementById('btn-font-next');
    const currentFontName = document.getElementById('current-font-name');
    const fontCounter = document.getElementById('font-counter');

    if (inlineFontSelector && btnFontPrev && btnFontNext && currentFontName && fontCounter) {
        const fonts = [
            { name: 'Roboto', family: "'Roboto', sans-serif" },
            { name: 'Lora', family: "'Lora', serif" }
        ];

        let currentFontIndex = 0;

        const updateFontUI = (skipApply = false) => {
            const font = fonts[currentFontIndex];
            currentFontName.textContent = font.name;
            fontCounter.textContent = `${currentFontIndex + 1} / ${fonts.length}`;
            
            if (!skipApply) {
                applyWithScrollPreservation('--reader-font', font.family);
            }
        };

        const nextFont = () => {
            currentFontIndex = (currentFontIndex + 1) % fonts.length;
            updateFontUI();
        };

        const prevFont = () => {
            currentFontIndex = (currentFontIndex - 1 + fonts.length) % fonts.length;
            updateFontUI();
        };

        btnFontNext.addEventListener('click', (e) => {
            e.stopPropagation();
            nextFont();
        });

        btnFontPrev.addEventListener('click', (e) => {
            e.stopPropagation();
            prevFont();
        });


        // Устанавливаем правильный текст счетчика при загрузке без вызова reflow
        updateFontUI(true);
    }

});
