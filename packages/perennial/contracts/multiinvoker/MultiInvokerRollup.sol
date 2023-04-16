// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "./MultiInvoker.sol";
import "../interfaces/IMultiInvokerRollup.sol";

/**
 * @title MultiInvokerRollup
 * @notice A calldata-optimized implementation of the Perennial MultiInvoker
 * @dev Supports the following encoding algorithm:

    1) List of Actions
     *  At the top-level input, the MultiInvoker takes a list of actions
     *  Each action is encoded using the below specification then concatenated together

    2) Actions
     *  First byte is the uint8 of the action's enum
     *  Rest of the data is a list of params encoded using the below specification then concatenated together

    3) Parameters
     *  uint256 - first byte is length, data is packed into smallest byte length that will fit value
     *  uint256[] - first byte is array length, each element is packed as a uint256 and concatenated together
     *  Address
        1) If address is already cached, index of the address is encoded as a uint256
        2) Otherwise the first byte is encoded as 0, and the following 20 bytes are the address
 */
contract MultiInvokerRollup is IMultiInvokerRollup, MultiInvoker {

    /// @dev Number of bytes in a uint256 type
    uint256 private constant UINT256_LENGTH = 32;

    /// @dev Number of bytes in a address type
    uint256 private constant ADDRESS_LENGTH = 20;

    /// @dev Number of bytes in a uint8 type
    uint256 private constant UINT8_LENGTH = 1;

    /// @dev Array of all stored addresses (users, products, vaults, etc) for calldata packing
    address[] public addressCache;

    /// @dev Index lookup of above array for constructing calldata
    mapping(address => uint256) public addressLookup;

    /**
     * @notice Constructs the contract
     * @param usdc_ The USDC token contract address
     * @param reserve_ The DSU batcher contract address
     * @param reserve_ The DSU reserve contract address
     * @param controller_ The Perennial controller contract address
     */
    constructor(Token6 usdc_, IBatcher batcher_, IEmptySetReserve reserve_, IController controller_)
    MultiInvoker(usdc_, batcher_, reserve_, controller_)
    {
        _cacheAddress(address(0)); // Cache 0-address to avoid 0-index lookup collision
    }

    /**
     * @notice This function serves exactly the same as invoke(Invocation[] memory invocations),
     *         but includes logic to handle the highly packed calldata
     * @dev Fallback eliminates the need to include function sig in calldata
     * @param input Packed data to pass to invoke logic
     * @return required no-op
     */
    fallback (bytes calldata input) external returns (bytes memory) {
        _decodeFallbackAndInvoke(input);
        return "";
    }

    /**
     * @notice Processes invocation with highly packed data
     * @dev
     * Encoding Scheme:
     *   [0:1] => uint action
     *   [1:2] => uint length of current encoded type
     *   [2:length] => current encoded type (see individual type decoding functions)
     * @param input Packed data to pass to invoke logic
     */
    function _decodeFallbackAndInvoke(bytes calldata input) internal {
        PTR memory ptr;
    
        while (ptr.pos < input.length) {
            uint8 action = _readUint8(input, ptr);

            if (action == 1) { // DEPOSIT
                (address account, address product, UFixed18 amount) =
                    (_readAndCacheAddress(input, ptr), _readAndCacheAddress(input, ptr), _readUFixed18(input, ptr));
                _deposit(account, IProduct(product), amount);

            } else if (action == 2) { // WITHDRAW
                (address receiver, address product, UFixed18 amount)  =
                    (_readAndCacheAddress(input, ptr), _readAndCacheAddress(input, ptr), _readUFixed18(input, ptr));
                _withdraw(receiver, IProduct(product), amount);

            } else if (action == 3) { // OPEN_TAKE
                (address product, UFixed18 amount) = (_readAndCacheAddress(input, ptr), _readUFixed18(input, ptr));
                _openTake(IProduct(product), amount);

            } else if (action == 4) { // CLOSE_TAKE
                (address product, UFixed18 amount) = (_readAndCacheAddress(input, ptr), _readUFixed18(input, ptr));
                _closeTake(IProduct(product), amount);

            } else if (action == 5) { // OPEN_MAKE 
                (address product, UFixed18 amount) = (_readAndCacheAddress(input, ptr), _readUFixed18(input, ptr));
                _openMake(IProduct(product), amount);

            } else if (action == 6) { // CLOSE_MAKE
                (address product, UFixed18 amount) = (_readAndCacheAddress(input, ptr), _readUFixed18(input, ptr));
                _closeMake(IProduct(product), amount);

            } else if (action == 7) { // CLAIM 
                (address product, uint256[] memory programIds) = 
                    (_readAndCacheAddress(input, ptr), _readUint256Array(input, ptr));
                _claim(IProduct(product), programIds);

            } else if (action == 8) { // WRAP 
                (address receiver, UFixed18 amount) = (_readAndCacheAddress(input, ptr), _readUFixed18(input, ptr));
                _wrap(receiver, amount);

            } else if (action == 9) { // UNWRAP
                (address receiver, UFixed18 amount) = (_readAndCacheAddress(input, ptr), _readUFixed18(input, ptr));
                _unwrap(receiver, amount);

            } else if (action == 10) { // WRAP_AND_DEPOSIT
                (address account, address product, UFixed18 amount) = 
                    (_readAndCacheAddress(input, ptr), _readAndCacheAddress(input, ptr), _readUFixed18(input, ptr));
                _wrapAndDeposit(account, IProduct(product), amount);

            } else if (action == 11) { // WITHDRAW_AND_UNWRAP
                (address receiver, address product, UFixed18 amount) =
                    (_readAndCacheAddress(input, ptr), _readAndCacheAddress(input, ptr), _readUFixed18(input, ptr));
                _withdrawAndUnwrap(receiver, IProduct(product), amount);

            } else if (action == 12) { // VAULT_DEPOSIT
                (address depositer, address vault, UFixed18 amount) =
                    (_readAndCacheAddress(input, ptr), _readAndCacheAddress(input, ptr), _readUFixed18(input, ptr));
                _vaultDeposit(depositer, IPerennialVault(vault), amount);

            } else if (action == 13) { // VAULT_REDEEM
                (address vault, UFixed18 shares) = (_readAndCacheAddress(input, ptr), _readUFixed18(input, ptr));
                _vaultRedeem(IPerennialVault(vault), shares);

            } else if (action == 14) { // VAULT_CLAIM
                (address owner, address vault) = (_readAndCacheAddress(input, ptr), _readAndCacheAddress(input, ptr));
                _vaultClaim(IPerennialVault(vault), owner);

            } else if (action == 15) { // VAULT_WRAP_AND_DEPOSIT 
                (address account, address vault, UFixed18 amount) =
                    (_readAndCacheAddress(input, ptr), _readAndCacheAddress(input, ptr), _readUFixed18(input, ptr));
                _vaultWrapAndDeposit(account, IPerennialVault(vault), amount);
            } else if (action == 16) { // CHARGE_FEE
                (address _interface, UFixed18 amount, bool wrapped) = 
                    (_readAndCacheAddress(input, ptr), _readUFixed18(input, ptr), _readBool(input, ptr));
                
                _chargeFee(_interface, amount, wrapped);
            }
        }
    }

    /**
     * @notice Unchecked sets address in cache
     * @param value Address to add to cache
     */
    function _cacheAddress(address value) private {
        uint256 index = addressCache.length;
        addressCache.push(value);
        addressLookup[value] = index;

        emit AddressAddedToCache(value, index);
    }

    /**
     * @notice Helper function to get address from calldata
     * @param input Full calldata payload
     * @param ptr Current index of input to start decoding
     * @return result The decoded address
     */
    function _readAndCacheAddress(bytes calldata input, PTR memory ptr) private returns (address result) {
        uint8 len = _readUint8(input, ptr);

        // user is new to registry, add next 20 bytes as address to registry and return address
        if (len == 0) {
            result = _bytesToAddress(input[ptr.pos:ptr.pos + ADDRESS_LENGTH]);
            ptr.pos += ADDRESS_LENGTH;

            _cacheAddress(result);
        } else {
            uint256 idx = _bytesToUint256(input[ptr.pos:ptr.pos + len]);
            ptr.pos += len;

            result = _lookupAddress(idx);
        }
    }

    /**
     * @notice Checked gets the address in cache mapped to the cache index
     * @dev There is an issue with the calldata if a txn uses cache before caching address
     * @param index The cache index
     * @return result Address stored at cache index
     */
    function _lookupAddress(uint256 index) private view returns (address result) {
        result = addressCache[index];
        if (result == address(0)) revert MultiInvokerRollupAddressIndexOutOfBoundsError();
    }

    function _readBool(bytes calldata input, PTR memory ptr) private pure returns (bool) {
        uint8 dir = _readUint8(input, ptr);
        if (dir > 0) {
            return true;
        } else {
            return false;
        }
    }

    /**
     * @notice Wraps next length of bytes as UFixed18
     * @param input Full calldata payload
     * @param ptr Current index of input to start decoding
     * @param ptr Current index of input to start decoding
     */
     function _readUFixed18(bytes calldata input, PTR memory ptr) private pure returns (UFixed18 result) {
        return UFixed18.wrap(_readUint256(input, ptr));
    }

    /**
     * @notice Unpacks next length of bytes as lengths of bytes into array of uint256
     * @param input Full calldata payload
     * @param ptr Current index of input to start decoding
     * @return result ProgramIds for CLAIM action
     */
    function _readUint256Array(bytes calldata input, PTR memory ptr) private pure returns (uint256[] memory result) {
        uint8 arrayLen = _readUint8(input, ptr);

        result = new uint256[](arrayLen);
        for (uint256 i; i < arrayLen; i++) {
            result[i] = _readUint256(input, ptr);
        }
    }

    /**
     * @notice Helper function to get uint8 length from calldata
     * @param input Full calldata payload
     * @param ptr Current index of input to start decoding
     * @return result The decoded uint8 length
     */
    function _readUint8(bytes calldata input, PTR memory ptr) private pure returns (uint8 result) {
        result = _bytesToUint8(input[ptr.pos:ptr.pos + UINT8_LENGTH]);
        ptr.pos += UINT8_LENGTH;
    }

    /**
     * @notice Helper function to get uint256 from calldata
     * @param input Full calldata payload
     * @param ptr Current index of input to start decoding
     * @return result The decoded uint256
     */
    function _readUint256(bytes calldata input, PTR memory ptr) private pure returns (uint256 result) {
        uint8 len = _readUint8(input, ptr);
        if (len > UINT256_LENGTH) revert MultiInvokerRollupInvalidUint256LengthError();

        result = _bytesToUint256(input[ptr.pos:ptr.pos + len]);
        ptr.pos += len;
    }

    /**
     * @notice Implementation of GNSPS' standard BytesLib.sol
     * @param input 1 byte slice to convert to uint8 to decode lengths
     * @return result The uint8 representation of input
     */
    function _bytesToUint8(bytes memory input) private pure returns (uint8 result) {
        assembly {
            result := mload(add(input, UINT8_LENGTH))
        }
    }

    /**
     * @dev This is called in decodeAccount and decodeProduct which both only pass 20 byte slices 
     * @notice Unchecked force of 20 bytes into address
     * @param input The 20 bytes to be converted to address
     * @return result Address representation of `input`
    */
    function _bytesToAddress(bytes memory input) private pure returns (address result) {
        assembly {
            result := mload(add(input, ADDRESS_LENGTH))
        }
    }
    
    /** 
     * @notice Unchecked loads arbitrarily-sized bytes into a uint
     * @dev Bytes length enforced as < max word size
     * @param input The bytes to convert to uint256
     * @return result The resulting uint256
     */
    function _bytesToUint256(bytes memory input) private pure returns (uint256 result) {
        uint256 len = input.length;

        assembly {
            result := mload(add(input, UINT256_LENGTH))
        }

        // readable right shift to change right padding of mload to left padding
        result >>= (UINT256_LENGTH - len) * 8;
    }
}
