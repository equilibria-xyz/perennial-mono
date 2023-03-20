pragma solidity ^0.8.15;

import "./MultiInvoker.sol";

/// @title A calldata-optimized implementation of the Perennial MultiInvoker 
/// @notice Retains same functionality and `invoke` entry point from inherited MultiInvoker
contract MultiInvokerRollup is MultiInvoker {

    event AddressAddedToCache(address indexed addr, uint256 nonce);

    /// @dev reverts when calldata has an issue. causes: length of bytes in a uint > || cache index empty
    error MultiInvokerRollupInvalidCalldataError();

    uint256 public addressNonce;
    mapping(uint => address) public addressCache;
    mapping(address => uint) public addressNonces;

    constructor(
        Token6 usdc_,
        IBatcher batcher_,
        IEmptySetReserve reserve_,
        IController controller_
    ) MultiInvoker(
        usdc_,
        batcher_,
        reserve_,
        controller_
    ) { return; }

    /// @dev fallback eliminates the need to include function sig in calldata
    fallback (bytes calldata input) external returns (bytes memory){
        _decodeFallbackAndInvoke(input);
        return "";
    }

    /**
     * @notice this function serves exactly the same as invoke(Invocation[] memory invocations),
     * but includes logic to handle the highly packed calldata
     * Encoding Scheme:
     * [0:1] => uint action 
     * [1:2] => uint length of current encoded type 
     * [2:length] => current encoded type (see individual type decoding functions)
     */
    function _decodeFallbackAndInvoke(bytes calldata input) internal {
        uint ptr;
        uint len = input.length;
    
        for (ptr; ptr < len;) {
            uint8 action = _bytesToUint8(input[ptr:ptr+1]);
            ptr += 1;

            // solidity doesn't like evaluating bytes as enums :/ 
            if (action == 1) { // DEPOSIT
                address account; address product; UFixed18 amount;
                (account, product, amount, ptr) = _decodeAddressAddressAmount(input, ptr);

                _deposit(account, IProduct(product), amount);
            } else if (action == 2) { // WITHDRAW
                address receiver; address product; UFixed18 amount;
                (receiver, product, amount, ptr) = _decodeAddressAddressAmount(input, ptr);

                _withdraw(receiver, IProduct(product), amount);
            } else if (action == 3) { // OPEN_TAKE
                address product; UFixed18 amount;
                (product, amount, ptr) = _decodeAddressAmount(input, ptr);

                _openTakeFor(IProduct(product), amount);  
            } else if (action == 4) { // CLOSE_TAKE
                address product; UFixed18 amount;
                (product, amount, ptr) = _decodeAddressAmount(input, ptr);

                _closeTakeFor(IProduct(product), amount);
            } else if (action == 5) { // OPEN_MAKE 
                address product; UFixed18 amount;
                (product, amount, ptr) = _decodeAddressAmount(input, ptr);

                _openMakeFor(IProduct(product), amount);
            } else if (action == 6) { // CLOSE_MAKE
                address product; UFixed18 amount;
                (product, amount, ptr) = _decodeAddressAmount(input, ptr);

                _closeMakeFor(IProduct(product), amount);
            } else if (action == 7) { // CLAIM 
                address product; uint256[] memory programIds;
                (product, programIds, ptr) = _decodeProductPrograms(input, ptr);

                _claimFor(IProduct(product), programIds);
            } else if (action == 8) { // WRAP 
                address receiver; UFixed18 amount;
                (receiver, amount, ptr) = _decodeAddressAmount(input, ptr);

                _wrap(receiver, amount);
            } else if (action == 9) { // UNWRAP
                address receiver; UFixed18 amount;
                (receiver, amount, ptr) = _decodeAddressAmount(input, ptr);

                _unwrap(receiver, amount);
            } else if (action == 10) { // WRAP_AND_DEPOSIT
                address account; address product; UFixed18 amount;
                (account, product, amount, ptr) = _decodeAddressAddressAmount(input, ptr);
                
               _wrapAndDeposit(account, IProduct(product), amount);
            } else if (action == 11) { // WITHDRAW_AND_UNWRAP
                address receiver; address product; UFixed18 amount;
                (receiver, product, amount, ptr) = _decodeAddressAddressAmount(input, ptr);

                _withdrawAndUnwrap(receiver, IProduct(product), amount);
            } else if (action == 12) { // VAULT_DEPOSIT
                address depositer; address vault; UFixed18 amount;
                (depositer, vault, amount, ptr) = _decodeAddressAddressAmount(input, ptr);

                _vaultDeposit(depositer, IPerennialVault(vault), amount);
            } else if (action == 13) { // VAULT_REDEEM
                address vault; UFixed18 shares;
                (vault, shares, ptr) = _decodeAddressAmount(input, ptr);

                _vaultRedeem(IPerennialVault(vault), shares);
            } else if (action == 14) { // VAULT_CLAIM
                address owner; address vault;
                (owner, vault, ptr) = _decodeAddressAddress(input, ptr);

                _vaultClaim(IPerennialVault(vault), owner);
            } else if (action == 15) { // VAULT_WRAP_AND_DEPOSIT 
                address account; address vault; UFixed18 amount;
                (account, vault, amount, ptr) = _decodeAddressAddressAmount(input, ptr);

                _vaultWrapAndDeposit(account, IPerennialVault(vault), amount);
            }
        }
    }

    /// @notice Unchecked sets address in cache
    /// @param addr Address to add to cache 
    function _setAddressCache(address addr) private {
        ++addressNonce;
        addressCache[addressNonce] = addr;
        addressNonces[addr] = addressNonce;
        emit AddressAddedToCache(addr, addressNonce);
    }
    
     /**
     * @notice Decodes next bytes of action as address, address
     * @param input Full calldata payload
     * @param ptr Current index of input to start decoding
     * @return First address for action 
     * @return Second address for action
     * @return Current index of calldata to continue decoding
     */
    function _decodeAddressAddress(bytes calldata input, uint ptr) private returns (address addr1, address addr2, uint) {
        (addr1, ptr) = _decodeAddress(input, ptr);
        (addr2, ptr) = _decodeAddress(input, ptr);

        return (addr1, addr2, ptr);
    }

    /**
     * @notice Decodes next bytes of action as address, address, and UFixed18
     * @param input Full calldata payload
     * @param ptr Current index of input to start decoding
     * @return First address for action 
     * @return Second address for action
     * @return UFixed18 wrpped amount for action
     * @return Current index of calldata to continue decoding
     */
    function _decodeAddressAddressAmount(bytes calldata input, uint ptr) private returns (address addr1, address addr2, UFixed18 amount, uint) {
        (addr1, ptr) = _decodeAddress(input, ptr);
        (addr2, ptr) = _decodeAddress(input, ptr);
        (amount, ptr) = _decodeAmountUFixed18(input, ptr);

        return (addr1, addr2, amount, ptr);
    }

    /**
     * @notice Decodes next bytes of action as address, UFixed18
     * @param input Full calldata payload
     * @param ptr Current index of input to start decoding
     * @return Address for action
     * @return UFixed18 wrapped amount for action
     * @return Current index of calldata to continue decoding
     */
    function _decodeAddressAmount(bytes calldata input, uint ptr) private returns (address addr1, UFixed18 amount, uint) {
        (addr1, ptr) = _decodeAddress(input, ptr);
        (amount, ptr) = _decodeAmountUFixed18(input, ptr);

        return(addr1, amount, ptr);
    }

    /**
     * @notice Decodes next bytes of action as address, uint256[]
     * @param input Full calldata payload
     * @param ptr Current index of input to start decoding
     * @return Product address for action
     * @return ProgramIds for action
     * @return Current index of calldata to continue decoding
     */
    function _decodeProductPrograms(bytes calldata input, uint ptr) private returns (address product, uint256[] memory programs, uint) {
        (product, ptr) = _decodeAddress(input, ptr);
        (programs, ptr) = _decodeUintArray(input, ptr);

        return(product, programs, ptr);
    }

    /** 
     * @notice decodes an address from calldata 
     * @dev if length == 0, stores next 20 bytes as address to cache 
     * else loading address from uint cache index
     * @param input Full calldata payload
     * @param ptr Current index of input to start decoding
     * @return Address encoded in calldata
     * @return Current index of calldata to continue decoding
    */
    function _decodeAddress(bytes calldata input, uint ptr) private returns (address addr, uint) {
        uint8 addrLen = _bytesToUint8(input[ptr:ptr+1]);
        ptr += 1;

        // user is new to registry, add next 20 bytes as address to registry and return address
        if (addrLen == 0) {
            addr = _bytesToAddress(input[ptr:ptr+20]);
            ptr += 20;

            _setAddressCache(addr);

        } else {
            uint addrNonceLookup = _bytesToUint256(input[ptr:ptr+addrLen]);
            ptr += addrLen;

            addr = _getAddressCacheSafe(addrNonceLookup);
        }

        return (addr, ptr);
    }

    /**
     * @notice checked gets the address in cache mapped to the cache index
     * @dev there is an issue with the calldata if a txn uses cache before caching address
     * @param nonce The cache index
     * @return Address stored at cache index
     */
    function _getAddressCacheSafe(uint nonce) private view returns (address addr){
        addr = addressCache[nonce];
        if (addr == address(0)) revert MultiInvokerRollupInvalidCalldataError();
    }

    /**
     * @notice wraps next length of bytes as UFixed18
     * @param input Full calldata payload
     * @param ptr Current index of input to start decoding
     * @param ptr Current index of input to start decoding
     * @return Current index of calldata to continue decoding
     */
     function _decodeAmountUFixed18(bytes calldata input, uint ptr) private view returns (UFixed18 result, uint) {
        uint temp;
        (temp, ptr) = _decodeUint(input, ptr);

        return(UFixed18.wrap(temp), ptr);
    }

    /**
     * @notice Unpacks next length of bytes into uint256
     * @param  input Full calldata payload
     * @param  ptr Current index of input to start decoding
     * @return Decoded uint
     * @return Current index of calldata to continue decoding
     */
    function _decodeUint(bytes calldata input, uint ptr) private pure returns (uint result, uint) {
        uint8 len = _bytesToUint8(input[ptr:ptr+1]);
        ++ptr;

        result = _bytesToUint256(input[ptr:ptr+len]);
        ptr += len;

        return (result, ptr);
    }

    /**
     * @notice Unpacks next length of bytes as lengths of bytes into array of uint256
     * @param  input Full calldata payload
     * @param  ptr Current index of input to start decoding
     * @param  ProgramIds for CLAIM action 
     * @return Current index of calldata to continue decoding
     */
    function _decodeUintArray(bytes calldata input, uint ptr) private pure returns (uint256[] memory, uint) {
        uint8 arrayLen = _bytesToUint8(input[ptr:ptr+1]);
        ++ptr;

        uint256[] memory result = new uint256[](arrayLen);

        for (uint count; count < arrayLen;) {
            uint currUint;

            (currUint, ptr) = _decodeUint(input, ptr);

            result[count] = currUint;

            ++count;
        }
        return (result, ptr);
    }

    /**
     * @dev This is called in decodeAccount and decodeProduct which both only pass 20 byte slices 
     * @notice Unchecked force of 20 bytes into address
     * @param input The 20 bytes to be converted to address
     * @return Address representation of `input`
    */
    function _bytesToAddress(bytes memory input) private pure returns (address addr) {
        assembly {
            addr := mload(add(input, 20))
        } 
    }

    /**
     * @notice Implementation of GNSPS' standard BytesLib.sol
     * @dev is only called with 1 byte slices
     * @dev there is an issue with calldata if a txn specifies the length of next bytes as > the max byte length of a uint256
     * @param input 1 byte slice to convert to uint8 to decode lengths
     * @return uint8 representation of input
     */
    function _bytesToUint8(bytes memory input) private pure returns (uint8 res) {
        assembly {
            res := mload(add(input, 0x1))
        }

        // length must not exceed max bytes length of a word/uint
        if (res > 32) revert MultiInvokerRollupInvalidCalldataError();
    }

    /** 
     * @notice Unchecked loads arbitrarily-sized bytes into a uint
     * @dev Bytes length enforced as < max word size in above function
     * @param input The bytes to convert to uint256
     * @return The resulting uint256
     */
    function _bytesToUint256(bytes memory input) private pure returns (uint256 res) {
        uint len = input.length;

        assembly {
            res := mload(add(input, 0x20))
        }

        if (res == 0x20) {
            return 0;
        }

        // readable right shift to change right padding of mload to left padding
        res >>= 256 - (len * 8);
    }
}