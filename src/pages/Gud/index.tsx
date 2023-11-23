/* prettier-ignore */
import { ChainId, CurrencyAmount, Token, Trade } from '@uniswap/sdk';
import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ArrowDown } from 'react-feather';
import { ThemeContext } from 'styled-components';
import AddressInputPanel from '../../components/AddressInputPanel';
import { ButtonError, ButtonPrimary, ButtonSlanted } from '../../components/Button';
import Column, { AutoColumn } from '../../components/Column';
import { CurrencyInputPanelGud } from '../../components/CurrencyInputPanel';
import { SwapPoolTabs } from '../../components/NavigationTabs';
import { AutoRow } from '../../components/Row';
import { ArrowWrapper, BottomGrouping, SwapCallbackError, Wrapper } from '../../components/swap/styleds';
import TokenWarningModal from '../../components/TokenWarningModal';
import ProgressSteps from '../../components/ProgressSteps';
import { GudHeader } from '../../components/swap/SwapHeader';
import { useActiveWeb3React } from '../../hooks';
import { useCurrency, useAllTokens } from '../../hooks/Tokens';
import { ApprovalState, useApproveCallbackFromTrade } from '../../hooks/useApproveCallback';
import useWrapCallback, { WrapType } from '../../hooks/useWrapCallback';
import { useAddPopup, useWalletModalToggle } from '../../state/application/hooks';
import { Field } from '../../state/swap/actions';
import {
  useDefaultsFromURLSearch,
  useDerivedSwapInfo,
  useSwapActionHandlers,
  useSwapState,
} from '../../state/swap/hooks';
import { useExpertModeManager, useUserSlippageTolerance } from '../../state/user/hooks';
import { LinkStyledButton } from '../../theme';
import { maxAmountSpend } from '../../utils/maxAmountSpend';
import { computeTradePriceBreakdown, warningSeverity } from '../../utils/prices';
import AppBody from '../AppBody';
import Loader from '../../components/Loader';
import { useLocation } from 'react-router-dom';
import { useWeb3React } from '@web3-react/core';
import { Contract, ethers, providers } from 'ethers';
import { parseUnits } from '@ethersproject/units';
import BRIDGE_ABI from './GUDBridgeServiceABI.json';

const ERC20_ABI = [
  {
    constant: true,
    inputs: [
      {
        name: '_owner',
        type: 'address',
      },
      {
        name: '_spender',
        type: 'address',
      },
    ],
    name: 'allowance',
    outputs: [
      {
        name: 'remaining',
        type: 'uint256',
      },
    ],
    payable: false,
    stateMutability: 'view',
    type: 'function',
  },
  {
    constant: false,
    inputs: [
      {
        name: 'spender',
        type: 'address',
      },
      {
        name: 'value',
        type: 'uint256',
      },
    ],
    name: 'approve',
    outputs: [
      {
        name: '',
        type: 'bool',
      },
    ],
    payable: false,
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    constant: true,
    inputs: [
      {
        name: '_owner',
        type: 'address',
      },
    ],
    name: 'balanceOf',
    outputs: [
      {
        name: 'balance',
        type: 'uint256',
      },
    ],
    type: 'function',
  },
];

const BRIDGE_ADDRESS = '0x419625Bf47bf4652839145d447C979814E283FAB';
// const GAUSS_PROVIDER_URL = 'https://rpc.gaussgang.com/';
// const MUMBAI_PROVIDER_URL = 'https://rpc-mumbai.maticvigil.com/';
// const POLYGON_PROVIDER_URL = 'https://polygon-rpc.com/';

export default function Gud() {
  const loadedUrlParams = useDefaultsFromURLSearch();

  const [expressMode, setExpressMode] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [approveDone, setApproveDone] = useState<boolean>(false);
  // const [correctPaperBalance, setCorrectPaperBalance] = useState<boolean>(false);
  const [chainSwitched, setChainSwitched] = useState<boolean>(false);
  const [token, setToken] = useState({
    symbol: 'GUD',
    address: '0x976cF0F344A41560a00447343Ff831E0FE619117',
  });
  const [allowance, setAllowance] = useState<string>('0');
  // const [paperBalance, setPaperBalance] = useState<string>('0');
  const [balance, setBalance] = useState('0');
  const [transactionReceipt, setTransactionReceipt] = useState<any>(null);
  const location = useLocation();
  const { chainId, library } = useWeb3React();

  const addPopup = useAddPopup();

  // const gaussProvider = new ethers.providers.JsonRpcProvider(GAUSS_PROVIDER_URL);
  // const mumbaiProvider = new ethers.providers.JsonRpcProvider(MUMBAI_PROVIDER_URL);
  // const polygonProvider = new ethers.providers.JsonRpcProvider(POLYGON_PROVIDER_URL);

  // token warning stuff
  const [loadedInputCurrency, loadedOutputCurrency] = [
    useCurrency(loadedUrlParams?.inputCurrencyId),
    useCurrency(loadedUrlParams?.outputCurrencyId),
  ];
  const [dismissTokenWarning, setDismissTokenWarning] = useState<boolean>(false);
  const urlLoadedTokens: Token[] = useMemo(
    () => [loadedInputCurrency, loadedOutputCurrency]?.filter((c): c is Token => c instanceof Token) ?? [],
    [loadedInputCurrency, loadedOutputCurrency]
  );
  const handleConfirmTokenWarning = useCallback(() => {
    setDismissTokenWarning(true);
  }, []);

  // dismiss warning if all imported tokens are in active lists
  const defaultTokens = useAllTokens();
  const importTokensNotInDefault =
    urlLoadedTokens &&
    urlLoadedTokens.filter((token: Token) => {
      return !Boolean(token.address in defaultTokens);
    });

  const { account } = useActiveWeb3React();
  const theme = useContext(ThemeContext);

  // toggle wallet when disconnected
  const toggleWalletModal = useWalletModalToggle();
  const [isExpertMode] = useExpertModeManager();

  // get custom setting values for user
  const [allowedSlippage] = useUserSlippageTolerance();

  // swap state
  const { independentField, typedValue, recipient } = useSwapState();
  const { v2Trade, currencyBalances, parsedAmount, currencies, inputError: swapInputError } = useDerivedSwapInfo();
  const {
    wrapType,
    execute: onWrap,
    inputError: wrapInputError,
  } = useWrapCallback(currencies[Field.INPUT], currencies[Field.OUTPUT], typedValue);

  const showWrap: boolean = wrapType !== WrapType.NOT_APPLICABLE;
  const trade = showWrap ? undefined : v2Trade;

  const parsedAmounts = showWrap
    ? {
        [Field.INPUT]: parsedAmount,
        [Field.OUTPUT]: parsedAmount,
      }
    : {
        [Field.INPUT]: independentField === Field.INPUT ? parsedAmount : trade?.inputAmount,
        [Field.OUTPUT]: independentField === Field.OUTPUT ? parsedAmount : trade?.outputAmount,
      };

  const { onSwitchTokens, onCurrencySelection, onUserInput, onChangeRecipient } = useSwapActionHandlers();
  const isValid = !swapInputError;
  const dependentField: Field = independentField === Field.INPUT ? Field.OUTPUT : Field.INPUT;

  const handleTypeInput = useCallback(
    (value: string) => {
      onUserInput(Field.INPUT, value);
    },
    [onUserInput]
  );

  const formattedAmounts = {
    [independentField]: typedValue,
    [dependentField]: showWrap
      ? parsedAmounts[independentField]?.toExact() ?? ''
      : parsedAmounts[dependentField]?.toSignificant(6) ?? '',
  };

  // check whether the user has approved the router on the input token
  const [approval, approveCallback] = useApproveCallbackFromTrade(trade, allowedSlippage);

  // check if user has gone through approval process, used to show two step buttons, reset on token change
  const [approvalSubmitted, setApprovalSubmitted] = useState<boolean>(false);

  // mark when a user has submitted an approval, reset onTokenSelection for input field
  useEffect(() => {
    if (approval === ApprovalState.PENDING) {
      setApprovalSubmitted(true);
    }
  }, [approval, approvalSubmitted]);

  const maxAmountInput: CurrencyAmount | undefined = maxAmountSpend(currencyBalances[Field.INPUT]);
  const atMaxAmountInput = Boolean(maxAmountInput && parsedAmounts[Field.INPUT]?.equalTo(maxAmountInput));

  const { priceImpactWithoutFee } = computeTradePriceBreakdown(trade);

  // warnings on slippage
  const priceImpactSeverity = warningSeverity(priceImpactWithoutFee);

  // show approve flow when: no error on inputs, not approved or pending, or approved in current session
  // never show if price impact is above threshold in non expert mode
  const showApproveFlow =
    !swapInputError &&
    (approval === ApprovalState.NOT_APPROVED ||
      approval === ApprovalState.PENDING ||
      (approvalSubmitted && approval === ApprovalState.APPROVED)) &&
    !(priceImpactSeverity > 3 && !isExpertMode);

  const handleInputSelect = useCallback(
    (inputCurrency) => {
      setApprovalSubmitted(false); // reset 2 step UI for approvals
      onCurrencySelection(Field.INPUT, inputCurrency);
    },
    [onCurrencySelection]
  );

  const handleMaxInput = useCallback(() => {
    onUserInput(Field.INPUT, Number(balance));
  }, [Number(balance), onUserInput]);

  const handleApprove = async () => {
    if (!library || !account) return;
    setLoading(true);
    setTransactionReceipt(null);
    const tokenContract = new Contract(token.address, ERC20_ABI, library.getSigner(account));
    try {
      // Convert the amount to wei format
      const amountInWei = parseUnits(formattedAmounts[Field.INPUT], 6); // adjust 18 if your token has a different number of decimals
      const tx = await tokenContract.approve(BRIDGE_ADDRESS, amountInWei);
      console.log('Approval transaction:', tx);
      await tx.wait(); // waits for the transaction to be mined
      setTransactionReceipt(tx);
      setApproveDone(true);
      addPopup({
        txn: {
          hash: tx.hash,
          success: true,
          summary: `${formattedAmounts[Field.INPUT]} ${token.symbol} has been approved for bridging to the ${
            chainId === ChainId.POLYGON ? 'GAUSS' : 'POLYGON'
          } network.`,
        },
      });
      console.log('Transaction has been mined!');
    } catch (err) {
      console.error('Approval error:', err);
    }
    setLoading(false);
  };

  async function handleBridge() {
    if (!library || !account) return;
    setLoading(true);
    setTransactionReceipt(null);
    const contract = new Contract(BRIDGE_ADDRESS, BRIDGE_ABI, library!.getSigner());
    const formattedAmount = parseUnits(formattedAmounts[Field.INPUT], 6);
    if (account) {
      try {
        const tx = await contract.transfer(account, formattedAmount, account, expressMode); // Assuming express mode is true
        const receipt = await tx.wait();
        setApproveDone(false);
        setTransactionReceipt(receipt);
        addPopup({
          txn: {
            hash: receipt.transactionHash,
            success: true,
            summary: `Bridged ${formattedAmounts[Field.INPUT]} ${token.symbol} to ${
              chainId === ChainId.POLYGON ? 'GUD' : 'USDC'
            } on the ${chainId === ChainId.POLYGON ? 'GAUSS' : 'POLYGON'} network.`,
          },
        });
        console.log('Transfer transaction receipt:', receipt);
      } catch (error) {
        console.error('Error during transfer:', error);
      }
    }
    onUserInput(Field.INPUT, '');
    setLoading(false);
  }

  useEffect(() => {
    // Check if the user is on the /gud page
    if (location.pathname === '/gud') {
      if (token.symbol === 'USDC') {
        // If they are not on POLYGON or MUMBAI
        if (chainId !== ChainId.POLYGON) {
          // Inform the user to switch networks
          alert('Please switch to Polygon Mainnet network to access this page.');

          // Optional: If you have permissions, you can programmatically switch the network for the user
          if (library && library.provider.request) {
            setChainSwitched(true);
            library.provider
              .request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: `0x${ChainId.POLYGON.toString(16)}` }], // This switches to Polygon, but you can set up logic for POLYGON as well
              })
              .catch((switchError) => {
                if (switchError.code === 4902) {
                  // add the network
                  library.provider
                    .request({
                      method: 'wallet_addEthereumChain',
                      params: [
                        {
                          chainId: `0x${ChainId.POLYGON.toString(16)}`,
                          chainName: 'Polygon Mainnet',
                          nativeCurrency: {
                            name: 'Matic',
                            symbol: 'MATIC',
                            decimals: 18,
                          },
                          rpcUrls: ['https://polygon-rpc.com/'],
                          blockExplorerUrls: ['https://polygonscan.com/'],
                        },
                      ],
                    })
                    .catch((addError) => {
                      console.error(addError);
                    });
                } else {
                  console.error(switchError);
                }
              });
          }
        }
      } else if (token.symbol === 'GUD') {
        // If they are not on GAUSS
        if (chainId !== ChainId.GAUSS) {
          // Inform the user to switch networks
          alert('Please switch to Gauss Mainnet network to access this page.');

          // Optional: If you have permissions, you can programmatically switch the network for the user
          if (library && library.provider.request) {
            setChainSwitched(true);
            library.provider
              .request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: `0x${ChainId.GAUSS.toString(16)}` }], // This switches to Polygon, but you can set up logic for POLYGON as well
              })
              .catch((switchError) => {
                if (switchError.code === 4902) {
                  // add the network
                  library.provider
                    .request({
                      method: 'wallet_addEthereumChain',
                      params: [
                        {
                          chainId: `0x${ChainId.GAUSS.toString(16)}`,
                          chainName: 'Gauss Chain Mainnet',
                          nativeCurrency: {
                            name: 'GANG',
                            symbol: 'GANG',
                            decimals: 18,
                          },
                          rpcUrls: ['https://rpc.gaussgang.com/'],
                          blockExplorerUrls: ['https://explorer.gaussgang.com/'],
                        },
                      ],
                    })
                    .catch((addError) => {
                      console.error(addError);
                    });
                } else {
                  console.error(switchError);
                }
              });
          }
        }
      }
    }
  }, [location.pathname, chainId, library, token]);

  useEffect(() => {
    if (chainId === ChainId.POLYGON || chainId === ChainId.GAUSS) {
      setChainSwitched(false);
    }
  }, [chainId]);

  // fetching the allowance for bridging
  useEffect(() => {
    if (account && library) {
      const tokenContract = new Contract(token.address, ERC20_ABI, library);

      const fetchAllowance = async () => {
        try {
          const result = await tokenContract.allowance(account, BRIDGE_ADDRESS);
          setAllowance(result.toString());
        } catch (err) {
          console.error('Error fetching allowance:', err);
        }
      };

      fetchAllowance();
    }
  }, [account, library, formattedAmounts[Field.INPUT]]);

  useEffect(() => {
    const formattedAllowance = Number(allowance) / 10 ** 6;
    formattedAllowance < Number(formattedAmounts[Field.INPUT]) ? setApproveDone(false) : setApproveDone(true);
  }, [allowance, formattedAmounts[Field.INPUT]]);
  // end fetching allowance

  // fetch PAPER BALANCE
  // useEffect(() => {
  //   if (account && library) {
  //     const tokenContract = new Contract('0xBB9408a0e1D65986D2Aa2bdE370E2bD6aa279fa1', ERC20_ABI, library); // Dog Token ($DGT) address for testing purposes

  //     const fetchBalance = async () => {
  //       try {
  //         const result = await tokenContract.balanceOf(account);
  //         setPaperBalance(result.toString());
  //       } catch (err) {
  //         console.error('Error fetching allowance:', err);
  //       }
  //     };

  //     fetchBalance();
  //   }
  // }, [account, library, formattedAmounts[Field.INPUT]]);

  // useEffect(() => {
  //   console.log('Amount:', 100000);
  //   const formattedBalance = Number(paperBalance) / 10 ** 18;
  //   console.log('Formatted balance:', formattedBalance);
  //   formattedBalance < 100000 ? setCorrectPaperBalance(false) : setCorrectPaperBalance(true);
  // }, [allowance, formattedAmounts[Field.INPUT]]);
  // end fetch PAPER BALANCE

  // WORKS - listening to events on the same chain (chain X listening to events on chain X)
  // useEffect(() => {
  //   // Create a contract instance
  //   const contract = new Contract(BRIDGE_ADDRESS, BRIDGE_ABI, library);

  //   if (chainId === ChainId.POLYGON) {
  //     // Listen to LockGUD event
  //     const onLockGUD = (sender, amount) => {
  //       console.log(`Token locked by ${sender} with amount ${amount}`);
  //       // Notify the user here, for example using a toast or a modal.
  //     };

  //     contract.on('LockGUD', onLockGUD);

  //     // Cleanup listener when component is unmounted
  //     return () => {
  //       contract.off('LockGUD', onLockGUD);
  //     };
  //   } else if (chainId === ChainId.GAUSS) {
  //     const onBurnGUD = (sender, amount) => {
  //       console.log(`Token burned by ${sender} with amount ${amount}`);
  //       // Notify the user here, for example using a toast or a modal.
  //     };

  //     contract.on('BurnGUD', onBurnGUD);

  //     // Cleanup listener when component is unmounted
  //     return () => {
  //       contract.off('BurnGUD', onBurnGUD);
  //     };
  //   }
  // }, [chainId, library]);

  // DOESN'T WORK - listening to events on different chains (chain X listening to events on chain Y)
  // useEffect(() => {
  //   // Depending on the current chainId, get the other chain's provider and contract instance
  //   let otherProvider, otherContract;
  //   if (chainId === ChainId.POLYGON) {
  //     otherProvider = gaussProvider;
  //     otherContract = new Contract(BRIDGE_ADDRESS, BRIDGE_ABI, otherProvider);
  //     // Listen to MintGUD event on Gauss chain (GAUSS)
  //     const onMintGUD = (recipient, amount) => {
  //       if (recipient.toLowerCase() === account.toLowerCase()) {
  //         // check if the event concerns the connected user
  //         console.log(`Token minted for ${recipient} with amount ${amount} on Gauss chain.`);
  //         // Notify the user here.
  //       }
  //     };
  //     otherContract.on('MintGUD', onMintGUD);
  //     return () => {
  //       otherContract.off('MintGUD', onMintGUD);
  //     };
  //   } else if (chainId === ChainId.GAUSS) {
  //     otherProvider = polygonProvider;
  //     otherContract = new Contract(BRIDGE_ADDRESS, BRIDGE_ABI, otherProvider);
  //     // Listen to UnlockGUD event on Mumbai
  //     const onUnlockGUD = (recipient, amount) => {
  //       if (recipient.toLowerCase() === account.toLowerCase()) {
  //         // check if the event concerns the connected user
  //         console.log(`Token unlocked for ${recipient} with amount ${amount} on POLYGON.`);
  //         // Notify the user here.
  //       }
  //     };
  //     otherContract.on('UnlockGUD', onUnlockGUD);

  //     return () => {
  //       otherContract.off('UnlockGUD', onUnlockGUD);
  //     };
  //   }
  // }, [chainId, account]);

  return (
    <>
      <TokenWarningModal
        isOpen={importTokensNotInDefault.length > 0 && !dismissTokenWarning}
        tokens={importTokensNotInDefault}
        onConfirm={handleConfirmTokenWarning}
      />
      <SwapPoolTabs active={'gud'} />
      <AppBody>
        <GudHeader expressMode={expressMode} setExpressMode={setExpressMode} />
        <Wrapper id="gud-page">
          {/* <ConfirmSwapModal
            isOpen={showConfirm}
            trade={trade}
            originalTrade={tradeToConfirm}
            onAcceptChanges={handleAcceptChanges}
            attemptingTxn={attemptingTxn}
            txHash={txHash}
            recipient={recipient}
            allowedSlippage={allowedSlippage}
            onConfirm={handleSwap}
            swapErrorMessage={swapErrorMessage}
            onDismiss={handleConfirmDismiss}
          /> */}

          <AutoColumn gap={'md'}>
            <CurrencyInputPanelGud
              label={'Input value:'}
              value={formattedAmounts[Field.INPUT]}
              showMaxButton={!atMaxAmountInput}
              currency={currencies[Field.INPUT]}
              onUserInput={handleTypeInput}
              onMax={handleMaxInput}
              balance={balance}
              setToken={setToken}
              token={token}
              setBalance={setBalance}
              onCurrencySelect={handleInputSelect}
              otherCurrency={currencies[Field.OUTPUT]}
              id="swap-currency-input"
            />

            {recipient !== null && !showWrap ? (
              <>
                <AutoRow justify="space-between" style={{ padding: '0 1rem' }}>
                  <ArrowWrapper clickable={false}>
                    <ArrowDown size="16" color={theme.text2} />
                  </ArrowWrapper>
                  <LinkStyledButton id="remove-recipient-button" onClick={() => onChangeRecipient(null)}>
                    - Remove send
                  </LinkStyledButton>
                </AutoRow>
                <AddressInputPanel id="recipient" value={recipient} onChange={onChangeRecipient} />
              </>
            ) : null}

            {/* {showWrap ? null : (
              <Card padding={showWrap ? '.25rem 1rem 0 1rem' : '0px'} borderRadius={'20px'}>
                <AutoColumn gap="8px" style={{ padding: '3px 4px' }}> */}
            {/* {Boolean(trade) && (
                    <RowBetween align="center">
                      <Text fontWeight={500} fontSize={14} color={theme.text2}>
                        Price
                      </Text>
                      <TradePrice
                        price={trade?.executionPrice}
                        showInverted={showInverted}
                        setShowInverted={setShowInverted}
                      />
                    </RowBetween>
                  )} */}
            {/* <RowBetween align="center"> */}
            {/* <ClickableText fontWeight={500} fontSize={14} color={theme.text2}> */}
            {/* onClick={toggleSettings}^ */}
            {/* Bridging Fee
                    </ClickableText>
                    <ClickableText fontWeight={500} fontSize={14} color={theme.text2}> */}
            {/* onClick={toggleSettings}^ */}
            {/* {allowedSlippage / 100}%
                    </ClickableText> */}
            {/* </RowBetween> */}
            {/* </AutoColumn>
              </Card>
            )} */}
          </AutoColumn>

          <BottomGrouping>
            {!account ? (
              <ButtonSlanted onClick={toggleWalletModal}>Connect Wallet</ButtonSlanted>
            ) : chainSwitched === true ? (
              <ButtonError disabled>
                <span>Chain switch in progress...</span>&nbsp;
                <Loader stroke="#A6AAB5" />
              </ButtonError>
            ) : chainId !== ChainId.POLYGON && token.symbol === 'USDC' ? (
              <ButtonError
                onClick={() => {
                  if (library && library.provider.request) {
                    library.provider
                      .request({
                        method: 'wallet_switchEthereumChain',
                        params: [{ chainId: `0x${ChainId.POLYGON.toString(16)}` }], // This switches to Polygon, but you can set up logic for POLYGON as well
                      })
                      .catch((switchError) => {
                        if (switchError.code === 4902) {
                          // add the network
                          library.provider
                            .request({
                              method: 'wallet_addEthereumChain',
                              params: [
                                {
                                  chainId: `0x${ChainId.POLYGON.toString(16)}`,
                                  chainName: 'Polygon Mainnet',
                                  nativeCurrency: {
                                    name: 'Matic',
                                    symbol: 'MATIC',
                                    decimals: 18,
                                  },
                                  rpcUrls: ['https://polygon-rpc.com/'],
                                  blockExplorerUrls: ['https://polygonscan.com/'],
                                },
                              ],
                            })
                            .catch((addError) => {
                              console.error(addError);
                            });
                        } else {
                          console.error(switchError);
                        }
                      });
                  }
                }}
              >
                Please switch to the Polygon Mainnet network
              </ButtonError>
            ) : chainId !== ChainId.GAUSS && token.symbol === 'GUD' ? (
              <ButtonError
                onClick={() => {
                  if (library && library.provider.request) {
                    library.provider
                      .request({
                        method: 'wallet_switchEthereumChain',
                        params: [{ chainId: `0x${ChainId.GAUSS.toString(16)}` }], // This switches to Polygon, but you can set up logic for POLYGON as well
                      })
                      .catch((switchError) => {
                        if (switchError.code === 4902) {
                          // add the network
                          library.provider
                            .request({
                              method: 'wallet_addEthereumChain',
                              params: [
                                {
                                  chainId: `0x${ChainId.GAUSS.toString(16)}`,
                                  chainName: 'Gauss Induction Labs',
                                  nativeCurrency: {
                                    name: 'GANG',
                                    symbol: 'GANG',
                                    decimals: 18,
                                  },
                                  rpcUrls: ['https://rpc.gaussgang.com/'],
                                  blockExplorerUrls: ['https://explorer.gaussgang.com/'],
                                },
                              ],
                            })
                            .catch((addError) => {
                              console.error(addError);
                            });
                        } else {
                          console.error(switchError);
                        }
                      });
                  }
                }}
              >
                Please switch to the Gauss Mainnet network
              </ButtonError>
            ) : formattedAmounts[Field.INPUT] === '' || Number(formattedAmounts[Field.INPUT]) > Number(balance) ? (
              <ButtonError disabled>Please enter valid amount</ButtonError>
            ) : loading === true ? (
              <ButtonPrimary disabled>
                <span>{!approveDone ? `Approving...` : `Bridging...`}</span>&nbsp;
                <Loader stroke="#A6AAB5" />
              </ButtonPrimary>
            ) : approveDone === false ? (
              <ButtonSlanted onClick={() => handleApprove()}>Approve</ButtonSlanted>
            ) : (
              <ButtonSlanted onClick={() => handleBridge()}>Bridge</ButtonSlanted>
            )}
            {showApproveFlow && (
              <Column style={{ marginTop: '1rem' }}>
                <ProgressSteps steps={[approval === ApprovalState.APPROVED]} />
              </Column>
            )}
          </BottomGrouping>
        </Wrapper>
      </AppBody>
    </>
  );
}
// line 679 start
// : correctPaperBalance === false ? (
//   <ButtonError disabled>Not enough $PAPER in wallet</ButtonError>
// )
