let counter = 0;

export function generateId(): string {
  return `${Date.now()}-${++counter}-${Math.random().toString(36).substr(2, 9)}`;
}
