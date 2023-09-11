import { Currency, ETHER, Token } from '@uniswap/sdk';

export function currencyId(currency: Currency): string {
  if (currency === ETHER) return 'GANG';
  if (currency instanceof Token) return currency.address;
  throw new Error('invalid currency');
}
