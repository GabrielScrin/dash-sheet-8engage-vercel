const cookieStorage = {
  getItem(key: string): string | null {
    const match = document.cookie
      .split('; ')
      .find(row => row.startsWith(key + '='));
    return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : null;
  },
  setItem(key: string, value: string): void {
    document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=3600; SameSite=Lax; Secure`;
  },
  removeItem(key: string): void {
    document.cookie = `${key}=; path=/; max-age=0; SameSite=Lax; Secure`;
  },
};

export default cookieStorage;
