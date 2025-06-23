// Jest setup for Chrome extension testing

// Mock chrome APIs for testing
(globalThis as any).chrome = {
  storage: {
    sync: {
      get: jest.fn(),
      set: jest.fn(),
    },
    onChanged: {
      addListener: jest.fn(),
    },
  },
  action: {
    setIcon: jest.fn(),
  },
}; 