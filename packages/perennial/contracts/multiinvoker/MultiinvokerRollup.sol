pragma solidity ^0.8.0;

import "./MultiInvoker.sol";

// import "forge-std/Test.sol";

contract MultiInvokerRollup is MultiInvoker {
    using UFixed18Lib for uint256;
    
    event LogBytes(bytes);
    event LogBytes32(bytes32);
    event LogUint(uint);

    event UserAddedToCache(address indexed user, uint256 nonce);
    event ProductAddedToCache(address indexed product, uint256 nonce);

    uint256 public userNonce;
    mapping(uint => address) public userCache;
    mapping(address => uint) public userNonces;

    uint256 public productNonce;
    mapping(uint => address) public productCache;
    mapping(address => uint) public productNonces; 
    

    constructor(  
        Token6 usdc_, 
        IBatcher batcher_, 
        IEmptySetReserve reserve_, 
        IController controller_
    ) MultiInvoker (
            usdc_, 
            batcher_, 
            reserve_, 
            controller_
    ) { }

    /// @dev fallback eliminates the need to include function sig
    fallback (bytes calldata input) external returns (bytes memory) {
        decodeFallbackAndInvoke(input);
    }

    /// @dev this function serves (@todo will serve*) exactly the same as invoke(Invocation[] memory invocations),
    /// but includes all the logic to handle the highly packed calldata
    function decodeFallbackAndInvoke(bytes calldata input) private {
        uint ptr;
        uint len = input.length;

        for(ptr; ptr < len;) {
            uint8 action = toUint8(input[ptr:ptr+1]);
            ptr += 1;

            // solidity doesn't like evaluating bytes as enums :/ 
            if(action == 1) { // DEPOSIT
                address account; IProduct product; UFixed18 amount;
                (account, product, amount, ptr) = decodeAddressProductAmount(input, ptr);

                depositTo(account, IProduct(product), amount);
            } else if (action == 2) { // WITHDRAW
                address receiver; IProduct product; UFixed18 amount;
                (receiver, product, amount, ptr) = decodeAddressProductAmount(input, ptr);

                collateral.withdrawFrom(msg.sender, receiver, product, amount);
            } else if (action == 3) { // OPEN_TAKE
                IProduct product; UFixed18 amount;
                (product, amount, ptr) = decodeProductAmount(input, ptr);

                product.openTakeFor(msg.sender, amount);  
            } else if (action == 4) { // CLOSE_TAKE
                IProduct product; UFixed18 amount;
                (product, amount, ptr) = decodeProductAmount(input, ptr);

                product.closeTakeFor(msg.sender, amount);
            } else if (action == 5) { // OPEN_MAKE 
                IProduct product; UFixed18 amount;
                (product, amount, ptr) = decodeProductAmount(input, ptr);

                product.openMakeFor(msg.sender, amount);
            } else if (action == 6) { // CLOSE_MAKE
                IProduct product; UFixed18 amount;
                (product, amount, ptr) = decodeProductAmount(input, ptr);

                product.closeMakeFor(msg.sender, amount);
            } else if (action == 7) { // CLAIM 
                IProduct product; uint256[] memory programIds;
                (product, programIds, ptr) = decodeProductPrograms(input, ptr);

                controller.incentivizer().claimFor(msg.sender, product, programIds);
            } else if (action == 8) { // WRAP 
                address receiver; UFixed18 amount;
                (receiver, amount, ptr) = decodeAddressAmount(input, ptr);

                wrap(receiver, amount);
            } else if (action == 9) { // UNWRAP
                address receiver; UFixed18 amount;
                (receiver, amount, ptr) = decodeAddressAmount(input, ptr);

                unwrap(receiver, amount);
            } else if (action == 10) { // WRAP_AND_DEPOSIT
                address account; IProduct product; UFixed18 amount;
                (account, product, amount, ptr) = decodeAddressProductAmount(input, ptr);
                
                wrapAndDeposit(account, product, amount);
            } else if (action == 11) { // WITHDRAW_AND_UNWRAP
                address receiver; IProduct product; UFixed18 amount;
                (receiver, product, amount, ptr) = decodeAddressProductAmount(input, ptr);

                withdrawAndUnwrap(receiver, product, amount);
            }
            
    
        }
    }

    /// Example Calldata Structure
    /// let ptr
    /// [ptr(userLen), ptr+1:userLen(user registry # OR 20 byte address if userLen == 0)] => address user 
    /// ptr += (userLen OR 20) + 1
    /// [ptr(prodcutLen), ptr+1:productLen(product registry # OR 20 byte address if prdoctLen == 0)] => address product
    /// ptr += (prodcutLen OR 20) + 1
    /// [ptr(amountLen), ptr:amountLen] => uint256 amount 


    // ARGUMENT TYPE DECODING //

    function decodeAddressProductAmount(bytes calldata input, uint ptr) private returns (address user, IProduct product, UFixed18 amount, uint) {
        (user, ptr) = decodeUser(input, ptr);
        (product, ptr) = decodeProduct(input, ptr);
        (amount, ptr) = decodeAmountUFixed18(input, ptr);

        return (user, product, amount, ptr);
    }

    function decodeProductPrograms(bytes calldata input, uint ptr) private returns(IProduct product, uint256[] memory programs, uint) {
        (product, ptr) = decodeProduct(input, ptr);
        (programs, ptr) = decodeUintArray(input, ptr);

        return(product, programs, ptr);
    }

    function decodeProductAmount(bytes calldata input, uint ptr) private returns (IProduct product, UFixed18 amount, uint) {
        (product, ptr) = decodeProduct(input, ptr);
        (amount, ptr) = decodeAmountUFixed18(input, ptr);

        return(product, UFixed18(amount), ptr);
    }

    function decodeAddressAmount(bytes calldata input, uint ptr) private returns(address account, UFixed18 amount, uint) {
        (account, ptr) = decodeUser(input, ptr);
        (amount, ptr) = decodeAmountUFixed18(input, ptr);
    }

    // INDIVIDUAL TYPE DECODING //

    function decodeAmountUFixed18(bytes calldata input, uint ptr) private returns (UFixed18 result, uint) {
        uint8 len = toUint8(input[ptr:ptr+1]);
        ptr += 1; 
        
        result = UFixed18Lib.from(bytesToUint(input[ptr:ptr+len]));
        ptr += len;

        return (result, ptr);
    }

    function decodeUint(bytes calldata input, uint ptr) private returns (uint result, uint) {
        uint8 len = toUint8(input[ptr:ptr+1]);
        ++ptr;

        result = bytesToUint(input[ptr:ptr+len]);
        ptr += len;

        return (result, ptr);
    }

 

    function decodeUFixed18Array(bytes calldata input, uint ptr) private returns (UFixed18[] memory, uint) {
        uint8 arrayLen = toUint8(input[ptr:ptr+1]);
        ++ptr;

        UFixed18[] memory result = new UFixed18[](arrayLen);
        uint count = 0;
        for(;count < arrayLen;) {
            UFixed18 currUint;

            (currUint, ptr) = decodeAmountUFixed18(input, ptr);
            
            result[count] = currUint;

            ++count;
        }

        return (result, ptr);
    }


    function decodeUintArray(bytes calldata input, uint ptr) private returns (uint256[] memory, uint) {
        uint8 arrayLen = toUint8(input[ptr:ptr+1]);
        ++ptr;

        uint256[] memory result = new uint256[](arrayLen);

        uint count = 0;
        for(;count < arrayLen;) {
            uint currUint;

            (currUint, ptr) = decodeUint(input, ptr);

            result[count] = currUint;

            ++count;
        }
        return (result, ptr);
    }



    function decodeUser(bytes calldata input, uint ptr) private returns(address userAddress, uint) {
        uint8 userLen = toUint8(input[ptr:ptr+1]);
        ptr += 1;

        // user is new to registry, add next 20 bytes as address to registry and return address
        if(userLen == 0) {
            userAddress = bytesToAddress(input[ptr:ptr+20]);
            ptr += 20;

            setUserCache(userAddress);

        } else {
            uint userNonceLookup = bytesToUint(input[ptr:ptr+userLen]);
            ptr += userLen;

            userAddress = getUserCacheSafe(userNonceLookup);
        }

        return (userAddress, ptr);
    }

    function decodeProduct(bytes calldata input, uint ptr) private returns(IProduct product, uint) {
        uint8 productLen = toUint8(input[ptr:ptr+1]);
        ptr += 1;

        // user is new to registry, add next 20 bytes as address to registry and return address
        if(productLen == 0) {
            product = IProduct(bytesToAddress(input[ptr:ptr+20]));
            ptr += 20;

            setProductCache(address(product));
            
        } else {
            uint productNonceLookup = bytesToUint(input[ptr:ptr+productLen]);
            ptr += productLen;

            product = IProduct(getProductCacheSafe(productNonceLookup));
        }

        return (product, ptr);
    }

    function setUserCache(address user) private {
        ++userNonce;
        userCache[userNonce] = user;
        userNonces[user] = userNonce;
        emit UserAddedToCache(user, userNonce);
    }

    function getUserCacheSafe(uint nonce) public returns (address user){
        user = userCache[nonce];
        if(user == address(0x0)) revert("Bad calldata, user not cache");
    }

    function setProductCache(address product) private {
        ++productNonce;
        productCache[productNonce] = product;
        productNonces[product] = productNonce;
        emit ProductAddedToCache(product, productNonce);
       
    }

    function getProductCacheSafe(uint nonce) public view returns(address product) {
        product = productCache[nonce];
        if(product == address(0x0)) revert("Bad calldata, product not found");
    }


    // HELPER FUNCTIONS //
    
    // Unchecked force of 20 bytes into address
    // This is called in decodeUser and decodeProduct which both only pass 20 byte slices 
    function bytesToAddress(bytes memory input) private pure returns (address addr) {
        assembly {
            addr := mload(add(input, 20))
        } 
    }

    // Unchecked implementation of GNSPS' standard BytesLib.sol
    function toUint8(bytes memory _bytes) internal pure returns (uint8 res) {
        assembly {
            res := mload(add(_bytes, 0x1))
        }
    }

    function toUint8(bytes memory _bytes, uint256 _start) internal pure returns (uint8 res) {
        require(_bytes.length >= _start + 1 , "toUint8_outOfBounds");
        uint8 tempUint;

        assembly {
            tempUint := mload(add(add(_bytes, 0x1), _start))
        }

        return tempUint;
    }



    // loads arbitrarily-sized byte array into a uint unchecked
    function bytesToUint(bytes memory _b) private returns(uint256 res) {
        uint len = _b.length;

        assembly {
            res := mload(add(_b, 0x20))
        }

        if(res == 0x20) {
            return 0;
        }

        // readable right shift to change right padding of mload to left padding
        res >>= 256 - (len * 8);
    }

}