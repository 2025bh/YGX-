import unittest
from calculate_quote import calculate

class Quantities(unittest.TestCase):
    def test_area_raw_precision_and_missing_price(self):
        r=calculate({'unit':'㎡','calc_mode':'rect','height':2101,'length':1803,'quantity':1,'price':None})
        self.assertEqual(r['area'],3.788103);self.assertIsNone(r['amount'])
    def test_length_no_area(self):
        r=calculate({'unit':'米','calc_mode':'length','height':100,'length':2400,'quantity':2,'price':10})
        self.assertEqual(r['total_length'],4.8);self.assertIsNone(r['area']);self.assertEqual(r['amount'],48)
    def test_pending_and_b(self):
        a={'unit':'㎡','calc_mode':'pending','height':2000,'length':1000,'quantity':1,'price':10}
        self.assertIsNone(calculate(a)['amount']);self.assertIsNone(calculate({**a,'calc_mode':'rect'},'B')['amount'])
    def test_quantity_null(self):
        r=calculate({'unit':'㎡','calc_mode':'rect','height':2000,'length':1000,'quantity':None})
        self.assertIsNone(r['area'])
    def test_mismatch(self):
        with self.assertRaises(ValueError):calculate({'unit':'㎡','calc_mode':'count','quantity':1})
    def test_manual(self):
        r=calculate({'unit':'㎡','calc_mode':'manual','area':2.5,'price':10})
        self.assertEqual(r['amount'],25)
if __name__=='__main__':unittest.main()
