import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeTaggedMessage, getActions, getEmotions } from '../src/emotion_classifier.js';
const stamps = [{word:'Hello',start_time:0.1,end_time:0.4},{word:',',start_time:0.4,end_time:0.5},
    {word:'world',start_time:0.6,end_time:1},{word:'!',start_time:1,end_time:1.1}];

test('whitespace normalization preserves exact cue anchors and ordinary emphasized words', () => {
    const parsed = decodeTaggedMessage('  *waves* Hello,   *nods* world! **Really** *interesting*.');
    assert.equal(parsed.text, 'Hello, world! Really interesting.');
    assert.deepEqual(parsed.actions, [{value:'wave',position:0},{value:'head_nod',position:7}]);
    assert.equal(decodeTaggedMessage('An unmatched * word stays.').text, 'An unmatched * word stays.');
    assert.equal(decodeTaggedMessage('I *juggle stars* sometimes.').text, 'I juggle stars sometimes.');
    assert.equal(decodeTaggedMessage('2*3*4 = 24').text, '2*3*4 = 24');
});

test('punctuation tokens, repeated and trailing cues align against actual spoken text', () => {
    const parsed = decodeTaggedMessage('*waves* Hello, *nods* *shrugs* world! *shakes head*');
    assert.deepEqual(getActions(stamps,parsed.actions,parsed.text), [
        {value:'wave',start:0.1},{value:'head_nod',start:0.6},
        {value:'shrugging',start:0.6},{value:'head_shake',start:1.1}]);
    assert.deepEqual(getActions(stamps,parsed.actions,parsed.text,new Set(['wave'])),[{value:'wave',start:0.1}]);
});

test('sigh can carry both channels; simultaneous emotions and malformed timestamps are safe', () => {
    const parsed = decodeTaggedMessage('*sighs* *smiles* Hello, world!');
    assert.equal(parsed.actions[0].value,'sigh');
    assert.deepEqual(getEmotions(stamps,parsed.emotions,parsed.text,1.2), [
        {value:'sad',start:0.1,end:1.2},{value:'happy',start:0.1,end:1.2}]);
    assert.deepEqual(getEmotions([],parsed.emotions,parsed.text),[]);
    assert.throws(() => getActions(stamps,parsed.actions,'Different speech'),/do not match/);
    assert.throws(() => getActions([{word:'Hello',start_time:NaN,end_time:1}],parsed.actions,'Hello'),/Invalid/);
});
