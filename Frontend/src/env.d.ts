interface ImportMetaEnv {
  /** Адрес игрового клиента для кнопки «Начать смену». */
  readonly VITE_GAME_URL?: string;
  /** Базовый URL API. Пусто — тот же origin (в dev /api проксируется на Backend). */
  readonly VITE_API_URL?: string;
}
