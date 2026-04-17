command =>  observed responses
0x01    =>  <Buffer fb bf 0a 01 4a 69 6d 75 32 d2 ed>
            <Buffer fb bf 0f 01 01 02 03 04 05 06 07 08 09 0a 47 ed>
            <Buffer fb bf 0a 01 4a 69 6d 75 32 d2 ed>           (SLOW! ? detect?)
0x02    =>  <Buffer fb bf 06 02 00 08 ed>
0x03    =>  <Buffer fb bf 06 03 00 09 ed>
0x04    =>  <Buffer fb bf 06 04 00 0a ed>
0x05    =>  <Buffer fb bf 06 05 00 0b ed>
0x06    =>  NO RESPONSE (00 - sometimes)
0x07    =>  <Buffer fb bf 06 07 02 0f ed>

0x08    =>  <Buffer fb bf 06 08 ee fc ed>
0x08 [8, 0] (after restart)
<= cmd=0x08 084a696d755f70312e37394a0000000f000000004116510100000000040000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000111031400000000000000000000000000000000000000000000000000000000000000000000000001000100010600 
0x0a    =>  <Buffer fb bf 06 0a 00 10 ed>

0x0b [11, 1, 1, 1]  <= cmd=0x0b 0b02aa0000007a  //
0x0b [11, 0] - servo posiotion
<= cmd=0x0b 0b01aa00000017 (11, 1, 170, 0, 0, 0, 23)
<= cmd=0x0b 0b02aa0000007a (11, 2, 170, 0, 0, 0, 122)
<= cmd=0x0b 0b03aa0000006e (11, 3, 170, 0, 0, 0, 110)
<= cmd=0x0b 0b04aa000000f6 (11, 4, 170, 0, 0, 0, 246)

0x0d    =>  <Buffer fb bf 06 0d 00 13 ed>
            <Buffer fb bf 06 0d 01 14 ed>



0x22    =>  <Buffer fb bf 0f 22 4a 69 6d 75 5f 70 31 2e 37 39 64 ed>
    => Sent cmd=0x22 [34, 0]
        <= cmd=0x22 224a696d755f70312e3739 (34, 74, 105, 109, 117, 95, 112, 49, 46, 55, 57)

0x27    =>  <Buffer fb bf 09 27 00 00 48 14 8c ed>
    => Sent cmd=0x27 [39, 0]
        <= cmd=0x27 2700004d38 (39, 0, 0, 77, 56)

0x2b    =>  <Buffer fb bf 07 2b 00 0b 3d ed>
0x2c    =>  <Buffer fb bf 12 2c 00 33 31 31 20 05 51 4d 57 3f 00 2d 00 59 ed>
    => Sent cmd=0x2c [44, 0]
        <= cmd=0x2c 2c003331312005514d573f002d00 (44, 0, 51, 49, 49, 32, 5, 81, 77, 87, 63, 0, 45, 0)

0x36    =>  <Buffer fb bf 0c 36 00 4a 49 4d 55 32 50 f9 ed>
    => Sent cmd=0x36 [54, 0]
        <= cmd=0x36 36004a494d553250 (54, 0, 74, 73, 77, 85, 50, 80)

    => Sent cmd=0x39 [57, 0]
        <= cmd=0x39 39ee (57, 238)

0x70    ->  <Buffer fb bf 08 70 01 74 01 ee ed>
    => Sent cmd=0x70 [112, 0]
        <= cmd=0x70 70007601 (112, 0, 118, 1)

0x71    =>  <Buffer fb bf 08 71 01 78 01 f3 ed>
    => Sent cmd=0x71 [113, 0]
        <= cmd=0x71 71007701 (113, 0, 119, 1)

0x72    =>  <Buffer fb bf 08 71 01 78 01 f3 ed>
0x73    =>  <Buffer fb bf 08 73 01 78 01 f5 ed>
    => Sent cmd=0x73 [115, 0]
        <= cmd=0x73 73007901 (115, 0, 121, 1)

0x74    =>  <Buffer fb bf 08 74 01 00 01 7e ed> (slow)
            <Buffer fb bf 08 74 01 02 00 7f ed>
0x75    =>  <Buffer fb bf 08 75 01 03 01 82 ed>
    multuple answer 0x75,0  - >>
    => Sent cmd=0x75 [117, 0]
        <= cmd=0x75 75000100 (117, 0, 1, 0)
        <= cmd=0x75 75000201 (117, 0, 2, 1)
        <= cmd=0x75 75000401 (117, 0, 4, 1)
        <= cmd=0x75 75000501 (117, 0, 5, 1)
        <= cmd=0x75 75000601 (117, 0, 6, 1)
        <= cmd=0x75 75000701 (117, 0, 7, 1)

0x7e    =>  <Buffer fb bf 0b 7e 01 01 01 02 88 00 16 ed>
0x7f    =>  <Buffer fb bf 08 7f 01 86 01 0f ed>
0x80    =>  <Buffer fb bf 07 80 01 03 8b ed>
0x80    =>  <Buffer fb bf 07 81 01 02 8b ed>
0x82    =>  <Buffer fb bf 07 82 01 02 8c ed>
0x83    =>  <Buffer fb bf 07 83 01 03 8e ed>
    => Sent cmd=0x83 [131, 255]
        <= cmd=0x83 83ff03 (131, 255, 3)

0x90    => !!! motor run !!! 
            <Buffer fb bf 08 90 01 01 80 1a ed>
0x90    =>  <Buffer fb bf 08 91 01 01 80 1b ed>
0x93    =>  <Buffer fb bf 08 93 01 01 80 1d ed>
