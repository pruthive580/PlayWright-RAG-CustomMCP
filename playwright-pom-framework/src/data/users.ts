/** SauceDemo test accounts. All accounts share the same password. */
export const PASSWORD = 'secret_sauce';

export const users = {
  standard: { username: 'standard_user', password: PASSWORD },
  lockedOut: { username: 'locked_out_user', password: PASSWORD },
  problem: { username: 'problem_user', password: PASSWORD },
} as const;

/** Data-driven negative-login cases: input plus the expected error text. */
export const invalidLogins = [
  {
    name: 'locked out user',
    username: 'locked_out_user',
    password: PASSWORD,
    error: 'Sorry, this user has been locked out.',
  },
  {
    name: 'wrong password',
    username: 'standard_user',
    password: 'wrong_password',
    error: 'Username and password do not match any user in this service',
  },
  {
    name: 'empty username',
    username: '',
    password: PASSWORD,
    error: 'Username is required',
  },
  {
    name: 'empty password',
    username: 'standard_user',
    password: '',
    error: 'Password is required',
  },
] as const;
