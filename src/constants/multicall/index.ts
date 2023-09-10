import { ChainId } from '@uniswap/sdk';
import MULTICALL_ABI from './abi.json';

const MULTICALL_NETWORKS: { [chainId in ChainId]: string } = {
  [ChainId.MAINNET]: '0xE389fE5122657a765b68d52cBE62673BDc6636A7',
  [ChainId.GIL]: '0xE389fE5122657a765b68d52cBE62673BDc6636A7',
};

export { MULTICALL_ABI, MULTICALL_NETWORKS };
