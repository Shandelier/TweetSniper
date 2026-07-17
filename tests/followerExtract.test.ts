import { extractFollowerCounts, isTwitterApiUrl } from '../src/followerExtract';

describe('isTwitterApiUrl', () => {
  test('matches Twitter/X API endpoints', () => {
    expect(isTwitterApiUrl('https://x.com/i/api/graphql/abc/HomeTimeline')).toBe(true);
    expect(isTwitterApiUrl('https://api.twitter.com/1.1/friends/list.json')).toBe(true);
    expect(isTwitterApiUrl('https://api.x.com/graphql/xyz/UserByScreenName')).toBe(true);
  });

  test('rejects unrelated URLs', () => {
    expect(isTwitterApiUrl('https://x.com/home')).toBe(false);
    expect(isTwitterApiUrl('https://pbs.twimg.com/media/foo.jpg')).toBe(false);
  });
});

describe('extractFollowerCounts', () => {
  test('extracts flat user objects (legacy REST shape)', () => {
    const payload = {
      users: [
        { screen_name: 'alice', followers_count: 1234, id_str: '1' },
        { screen_name: 'bob', followers_count: 0 },
      ],
    };
    expect(extractFollowerCounts(payload)).toEqual([
      { handle: 'alice', count: 1234 },
      { handle: 'bob', count: 0 },
    ]);
  });

  test('extracts GraphQL shape with screen_name inside legacy', () => {
    const payload = {
      data: {
        user: {
          result: {
            __typename: 'User',
            legacy: { screen_name: 'carol', followers_count: 98765 },
          },
        },
      },
    };
    expect(extractFollowerCounts(payload)).toEqual([{ handle: 'carol', count: 98765 }]);
  });

  test('extracts GraphQL shape with screen_name moved to core', () => {
    const payload = {
      data: {
        user: {
          result: {
            __typename: 'User',
            core: { screen_name: 'dave', name: 'Dave' },
            legacy: { followers_count: 42 },
          },
        },
      },
    };
    expect(extractFollowerCounts(payload)).toEqual([{ handle: 'dave', count: 42 }]);
  });

  test('collects users from deeply nested timeline entries and dedupes', () => {
    const user = {
      core: { screen_name: 'erin' },
      legacy: { followers_count: 500 },
    };
    const payload = {
      data: {
        home: {
          instructions: [
            {
              entries: [
                { content: { itemContent: { tweet_results: { result: { core: { user_results: { result: user } } } } } } },
                { content: { itemContent: { tweet_results: { result: { core: { user_results: { result: user } } } } } } },
              ],
            },
          ],
        },
      },
    };
    expect(extractFollowerCounts(payload)).toEqual([{ handle: 'erin', count: 500 }]);
  });

  test('ignores invalid handles and counts', () => {
    const payload = {
      users: [
        { screen_name: 'way_too_long_handle_over_15', followers_count: 10 },
        { screen_name: 'ok', followers_count: -5 },
        { screen_name: 'ok2', followers_count: 'many' },
        { screen_name: 42, followers_count: 10 },
      ],
    };
    expect(extractFollowerCounts(payload)).toEqual([]);
  });

  test('handles non-object payloads without throwing', () => {
    expect(extractFollowerCounts(null)).toEqual([]);
    expect(extractFollowerCounts('string')).toEqual([]);
    expect(extractFollowerCounts([1, 2, 3])).toEqual([]);
  });
});
