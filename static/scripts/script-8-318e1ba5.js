(function () {
  "use strict";

//---------------------------------------------------------------------
//
// QR Code Generator for JavaScript
//
// Copyright (c) 2009 Kazuhiko Arase
//
// URL: http://www.d-project.com/
//
// Licensed under the MIT license:
//  http://www.opensource.org/licenses/mit-license.php
//
// The word 'QR Code' is registered trademark of
// DENSO WAVE INCORPORATED
//  http://www.denso-wave.com/qrcode/faqpatent-e.html
//
//---------------------------------------------------------------------

var qrcode = function() {

  //---------------------------------------------------------------------
  // qrcode
  //---------------------------------------------------------------------

  /**
   * qrcode
   * @param typeNumber 1 to 40
   * @param errorCorrectionLevel 'L','M','Q','H'
   */
  var qrcode = function(typeNumber, errorCorrectionLevel) {

    var PAD0 = 0xEC;
    var PAD1 = 0x11;

    var _typeNumber = typeNumber;
    var _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
    var _modules = null;
    var _moduleCount = 0;
    var _dataCache = null;
    var _dataList = [];

    var _this = {};

    var makeImpl = function(test, maskPattern) {

      _moduleCount = _typeNumber * 4 + 17;
      _modules = function(moduleCount) {
        var modules = new Array(moduleCount);
        for (var row = 0; row < moduleCount; row += 1) {
          modules[row] = new Array(moduleCount);
          for (var col = 0; col < moduleCount; col += 1) {
            modules[row][col] = null;
          }
        }
        return modules;
      }(_moduleCount);

      setupPositionProbePattern(0, 0);
      setupPositionProbePattern(_moduleCount - 7, 0);
      setupPositionProbePattern(0, _moduleCount - 7);
      setupPositionAdjustPattern();
      setupTimingPattern();
      setupTypeInfo(test, maskPattern);

      if (_typeNumber >= 7) {
        setupTypeNumber(test);
      }

      if (_dataCache == null) {
        _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
      }

      mapData(_dataCache, maskPattern);
    };

    var setupPositionProbePattern = function(row, col) {

      for (var r = -1; r <= 7; r += 1) {

        if (row + r <= -1 || _moduleCount <= row + r) continue;

        for (var c = -1; c <= 7; c += 1) {

          if (col + c <= -1 || _moduleCount <= col + c) continue;

          if ( (0 <= r && r <= 6 && (c == 0 || c == 6) )
              || (0 <= c && c <= 6 && (r == 0 || r == 6) )
              || (2 <= r && r <= 4 && 2 <= c && c <= 4) ) {
            _modules[row + r][col + c] = true;
          } else {
            _modules[row + r][col + c] = false;
          }
        }
      }
    };

    var getBestMaskPattern = function() {

      var minLostPoint = 0;
      var pattern = 0;

      for (var i = 0; i < 8; i += 1) {

        makeImpl(true, i);

        var lostPoint = QRUtil.getLostPoint(_this);

        if (i == 0 || minLostPoint > lostPoint) {
          minLostPoint = lostPoint;
          pattern = i;
        }
      }

      return pattern;
    };

    var setupTimingPattern = function() {

      for (var r = 8; r < _moduleCount - 8; r += 1) {
        if (_modules[r][6] != null) {
          continue;
        }
        _modules[r][6] = (r % 2 == 0);
      }

      for (var c = 8; c < _moduleCount - 8; c += 1) {
        if (_modules[6][c] != null) {
          continue;
        }
        _modules[6][c] = (c % 2 == 0);
      }
    };

    var setupPositionAdjustPattern = function() {

      var pos = QRUtil.getPatternPosition(_typeNumber);

      for (var i = 0; i < pos.length; i += 1) {

        for (var j = 0; j < pos.length; j += 1) {

          var row = pos[i];
          var col = pos[j];

          if (_modules[row][col] != null) {
            continue;
          }

          for (var r = -2; r <= 2; r += 1) {

            for (var c = -2; c <= 2; c += 1) {

              if (r == -2 || r == 2 || c == -2 || c == 2
                  || (r == 0 && c == 0) ) {
                _modules[row + r][col + c] = true;
              } else {
                _modules[row + r][col + c] = false;
              }
            }
          }
        }
      }
    };

    var setupTypeNumber = function(test) {

      var bits = QRUtil.getBCHTypeNumber(_typeNumber);

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
      }

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
      }
    };

    var setupTypeInfo = function(test, maskPattern) {

      var data = (_errorCorrectionLevel << 3) | maskPattern;
      var bits = QRUtil.getBCHTypeInfo(data);

      // vertical
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 6) {
          _modules[i][8] = mod;
        } else if (i < 8) {
          _modules[i + 1][8] = mod;
        } else {
          _modules[_moduleCount - 15 + i][8] = mod;
        }
      }

      // horizontal
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 8) {
          _modules[8][_moduleCount - i - 1] = mod;
        } else if (i < 9) {
          _modules[8][15 - i - 1 + 1] = mod;
        } else {
          _modules[8][15 - i - 1] = mod;
        }
      }

      // fixed module
      _modules[_moduleCount - 8][8] = (!test);
    };

    var mapData = function(data, maskPattern) {

      var inc = -1;
      var row = _moduleCount - 1;
      var bitIndex = 7;
      var byteIndex = 0;
      var maskFunc = QRUtil.getMaskFunction(maskPattern);

      for (var col = _moduleCount - 1; col > 0; col -= 2) {

        if (col == 6) col -= 1;

        while (true) {

          for (var c = 0; c < 2; c += 1) {

            if (_modules[row][col - c] == null) {

              var dark = false;

              if (byteIndex < data.length) {
                dark = ( ( (data[byteIndex] >>> bitIndex) & 1) == 1);
              }

              var mask = maskFunc(row, col - c);

              if (mask) {
                dark = !dark;
              }

              _modules[row][col - c] = dark;
              bitIndex -= 1;

              if (bitIndex == -1) {
                byteIndex += 1;
                bitIndex = 7;
              }
            }
          }

          row += inc;

          if (row < 0 || _moduleCount <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    };

    var createBytes = function(buffer, rsBlocks) {

      var offset = 0;

      var maxDcCount = 0;
      var maxEcCount = 0;

      var dcdata = new Array(rsBlocks.length);
      var ecdata = new Array(rsBlocks.length);

      for (var r = 0; r < rsBlocks.length; r += 1) {

        var dcCount = rsBlocks[r].dataCount;
        var ecCount = rsBlocks[r].totalCount - dcCount;

        maxDcCount = Math.max(maxDcCount, dcCount);
        maxEcCount = Math.max(maxEcCount, ecCount);

        dcdata[r] = new Array(dcCount);

        for (var i = 0; i < dcdata[r].length; i += 1) {
          dcdata[r][i] = 0xff & buffer.getBuffer()[i + offset];
        }
        offset += dcCount;

        var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
        var rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);

        var modPoly = rawPoly.mod(rsPoly);
        ecdata[r] = new Array(rsPoly.getLength() - 1);
        for (var i = 0; i < ecdata[r].length; i += 1) {
          var modIndex = i + modPoly.getLength() - ecdata[r].length;
          ecdata[r][i] = (modIndex >= 0)? modPoly.getAt(modIndex) : 0;
        }
      }

      var totalCodeCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalCodeCount += rsBlocks[i].totalCount;
      }

      var data = new Array(totalCodeCount);
      var index = 0;

      for (var i = 0; i < maxDcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < dcdata[r].length) {
            data[index] = dcdata[r][i];
            index += 1;
          }
        }
      }

      for (var i = 0; i < maxEcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < ecdata[r].length) {
            data[index] = ecdata[r][i];
            index += 1;
          }
        }
      }

      return data;
    };

    var createData = function(typeNumber, errorCorrectionLevel, dataList) {

      var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectionLevel);

      var buffer = qrBitBuffer();

      for (var i = 0; i < dataList.length; i += 1) {
        var data = dataList[i];
        buffer.put(data.getMode(), 4);
        buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
        data.write(buffer);
      }

      // calc num max data.
      var totalDataCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalDataCount += rsBlocks[i].dataCount;
      }

      if (buffer.getLengthInBits() > totalDataCount * 8) {
        throw 'code length overflow. ('
          + buffer.getLengthInBits()
          + '>'
          + totalDataCount * 8
          + ')';
      }

      // end code
      if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
        buffer.put(0, 4);
      }

      // padding
      while (buffer.getLengthInBits() % 8 != 0) {
        buffer.putBit(false);
      }

      // padding
      while (true) {

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD0, 8);

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD1, 8);
      }

      return createBytes(buffer, rsBlocks);
    };

    _this.addData = function(data, mode) {

      mode = mode || 'Byte';

      var newData = null;

      switch(mode) {
      case 'Numeric' :
        newData = qrNumber(data);
        break;
      case 'Alphanumeric' :
        newData = qrAlphaNum(data);
        break;
      case 'Byte' :
        newData = qr8BitByte(data);
        break;
      case 'Kanji' :
        newData = qrKanji(data);
        break;
      default :
        throw 'mode:' + mode;
      }

      _dataList.push(newData);
      _dataCache = null;
    };

    _this.isDark = function(row, col) {
      if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
        throw row + ',' + col;
      }
      return _modules[row][col];
    };

    _this.getModuleCount = function() {
      return _moduleCount;
    };

    _this.make = function() {
      if (_typeNumber < 1) {
        var typeNumber = 1;

        for (; typeNumber < 40; typeNumber++) {
          var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, _errorCorrectionLevel);
          var buffer = qrBitBuffer();

          for (var i = 0; i < _dataList.length; i++) {
            var data = _dataList[i];
            buffer.put(data.getMode(), 4);
            buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
            data.write(buffer);
          }

          var totalDataCount = 0;
          for (var i = 0; i < rsBlocks.length; i++) {
            totalDataCount += rsBlocks[i].dataCount;
          }

          if (buffer.getLengthInBits() <= totalDataCount * 8) {
            break;
          }
        }

        _typeNumber = typeNumber;
      }

      makeImpl(false, getBestMaskPattern() );
    };

    _this.createTableTag = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var qrHtml = '';

      qrHtml += '<table style="';
      qrHtml += ' border-width: 0px; border-style: none;';
      qrHtml += ' border-collapse: collapse;';
      qrHtml += ' padding: 0px; margin: ' + margin + 'px;';
      qrHtml += '">';
      qrHtml += '<tbody>';

      for (var r = 0; r < _this.getModuleCount(); r += 1) {

        qrHtml += '<tr>';

        for (var c = 0; c < _this.getModuleCount(); c += 1) {
          qrHtml += '<td style="';
          qrHtml += ' border-width: 0px; border-style: none;';
          qrHtml += ' border-collapse: collapse;';
          qrHtml += ' padding: 0px; margin: 0px;';
          qrHtml += ' width: ' + cellSize + 'px;';
          qrHtml += ' height: ' + cellSize + 'px;';
          qrHtml += ' background-color: ';
          qrHtml += _this.isDark(r, c)? '#000000' : '#ffffff';
          qrHtml += ';';
          qrHtml += '"/>';
        }

        qrHtml += '</tr>';
      }

      qrHtml += '</tbody>';
      qrHtml += '</table>';

      return qrHtml;
    };

    _this.createSvgTag = function(cellSize, margin, alt, title) {

      var opts = {};
      if (typeof arguments[0] == 'object') {
        // Called by options.
        opts = arguments[0];
        // overwrite cellSize and margin.
        cellSize = opts.cellSize;
        margin = opts.margin;
        alt = opts.alt;
        title = opts.title;
      }

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      // Compose alt property surrogate
      alt = (typeof alt === 'string') ? {text: alt} : alt || {};
      alt.text = alt.text || null;
      alt.id = (alt.text) ? alt.id || 'qrcode-description' : null;

      // Compose title property surrogate
      title = (typeof title === 'string') ? {text: title} : title || {};
      title.text = title.text || null;
      title.id = (title.text) ? title.id || 'qrcode-title' : null;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var c, mc, r, mr, qrSvg='', rect;

      rect = 'l' + cellSize + ',0 0,' + cellSize +
        ' -' + cellSize + ',0 0,-' + cellSize + 'z ';

      qrSvg += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"';
      qrSvg += !opts.scalable ? ' width="' + size + 'px" height="' + size + 'px"' : '';
      qrSvg += ' viewBox="0 0 ' + size + ' ' + size + '" ';
      qrSvg += ' preserveAspectRatio="xMinYMin meet"';
      qrSvg += (title.text || alt.text) ? ' role="img" aria-labelledby="' +
          escapeXml([title.id, alt.id].join(' ').trim() ) + '"' : '';
      qrSvg += '>';
      qrSvg += (title.text) ? '<title id="' + escapeXml(title.id) + '">' +
          escapeXml(title.text) + '</title>' : '';
      qrSvg += (alt.text) ? '<description id="' + escapeXml(alt.id) + '">' +
          escapeXml(alt.text) + '</description>' : '';
      qrSvg += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>';
      qrSvg += '<path d="';

      for (r = 0; r < _this.getModuleCount(); r += 1) {
        mr = r * cellSize + margin;
        for (c = 0; c < _this.getModuleCount(); c += 1) {
          if (_this.isDark(r, c) ) {
            mc = c*cellSize+margin;
            qrSvg += 'M' + mc + ',' + mr + rect;
          }
        }
      }

      qrSvg += '" stroke="transparent" fill="black"/>';
      qrSvg += '</svg>';

      return qrSvg;
    };

    _this.createDataURL = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      return createDataURL(size, size, function(x, y) {
        if (min <= x && x < max && min <= y && y < max) {
          var c = Math.floor( (x - min) / cellSize);
          var r = Math.floor( (y - min) / cellSize);
          return _this.isDark(r, c)? 0 : 1;
        } else {
          return 1;
        }
      } );
    };

    _this.createImgTag = function(cellSize, margin, alt) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;

      var img = '';
      img += '<img';
      img += '\u0020src="';
      img += _this.createDataURL(cellSize, margin);
      img += '"';
      img += '\u0020width="';
      img += size;
      img += '"';
      img += '\u0020height="';
      img += size;
      img += '"';
      if (alt) {
        img += '\u0020alt="';
        img += escapeXml(alt);
        img += '"';
      }
      img += '/>';

      return img;
    };

    var escapeXml = function(s) {
      var escaped = '';
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charAt(i);
        switch(c) {
        case '<': escaped += '&lt;'; break;
        case '>': escaped += '&gt;'; break;
        case '&': escaped += '&amp;'; break;
        case '"': escaped += '&quot;'; break;
        default : escaped += c; break;
        }
      }
      return escaped;
    };

    var _createHalfASCII = function(margin) {
      var cellSize = 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r1, r2, p;

      var blocks = {
        '██': '█',
        '█ ': '▀',
        ' █': '▄',
        '  ': ' '
      };

      var blocksLastLineNoMargin = {
        '██': '▀',
        '█ ': '▀',
        ' █': ' ',
        '  ': ' '
      };

      var ascii = '';
      for (y = 0; y < size; y += 2) {
        r1 = Math.floor((y - min) / cellSize);
        r2 = Math.floor((y + 1 - min) / cellSize);
        for (x = 0; x < size; x += 1) {
          p = '█';

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) {
            p = ' ';
          }

          if (min <= x && x < max && min <= y+1 && y+1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) {
            p += ' ';
          }
          else {
            p += '█';
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          ascii += (margin < 1 && y+1 >= max) ? blocksLastLineNoMargin[p] : blocks[p];
        }

        ascii += '\n';
      }

      if (size % 2 && margin > 0) {
        return ascii.substring(0, ascii.length - size - 1) + Array(size+1).join('▀');
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.createASCII = function(cellSize, margin) {
      cellSize = cellSize || 1;

      if (cellSize < 2) {
        return _createHalfASCII(margin);
      }

      cellSize -= 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r, p;

      var white = Array(cellSize+1).join('██');
      var black = Array(cellSize+1).join('  ');

      var ascii = '';
      var line = '';
      for (y = 0; y < size; y += 1) {
        r = Math.floor( (y - min) / cellSize);
        line = '';
        for (x = 0; x < size; x += 1) {
          p = 1;

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) {
            p = 0;
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          line += p ? white : black;
        }

        for (r = 0; r < cellSize; r += 1) {
          ascii += line + '\n';
        }
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.renderTo2dContext = function(context, cellSize) {
      cellSize = cellSize || 2;
      var length = _this.getModuleCount();
      for (var row = 0; row < length; row++) {
        for (var col = 0; col < length; col++) {
          context.fillStyle = _this.isDark(row, col) ? 'black' : 'white';
          context.fillRect(row * cellSize, col * cellSize, cellSize, cellSize);
        }
      }
    }

    return _this;
  };

  //---------------------------------------------------------------------
  // qrcode.stringToBytes
  //---------------------------------------------------------------------

  qrcode.stringToBytesFuncs = {
    'default' : function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        bytes.push(c & 0xff);
      }
      return bytes;
    }
  };

  qrcode.stringToBytes = qrcode.stringToBytesFuncs['default'];

  //---------------------------------------------------------------------
  // qrcode.createStringToBytes
  //---------------------------------------------------------------------

  /**
   * @param unicodeData base64 string of byte array.
   * [16bit Unicode],[16bit Bytes], ...
   * @param numChars
   */
  qrcode.createStringToBytes = function(unicodeData, numChars) {

    // create conversion map.

    var unicodeMap = function() {

      var bin = base64DecodeInputStream(unicodeData);
      var read = function() {
        var b = bin.read();
        if (b == -1) throw 'eof';
        return b;
      };

      var count = 0;
      var unicodeMap = {};
      while (true) {
        var b0 = bin.read();
        if (b0 == -1) break;
        var b1 = read();
        var b2 = read();
        var b3 = read();
        var k = String.fromCharCode( (b0 << 8) | b1);
        var v = (b2 << 8) | b3;
        unicodeMap[k] = v;
        count += 1;
      }
      if (count != numChars) {
        throw count + ' != ' + numChars;
      }

      return unicodeMap;
    }();

    var unknownChar = '?'.charCodeAt(0);

    return function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        if (c < 128) {
          bytes.push(c);
        } else {
          var b = unicodeMap[s.charAt(i)];
          if (typeof b == 'number') {
            if ( (b & 0xff) == b) {
              // 1byte
              bytes.push(b);
            } else {
              // 2bytes
              bytes.push(b >>> 8);
              bytes.push(b & 0xff);
            }
          } else {
            bytes.push(unknownChar);
          }
        }
      }
      return bytes;
    };
  };

  //---------------------------------------------------------------------
  // QRMode
  //---------------------------------------------------------------------

  var QRMode = {
    MODE_NUMBER :    1 << 0,
    MODE_ALPHA_NUM : 1 << 1,
    MODE_8BIT_BYTE : 1 << 2,
    MODE_KANJI :     1 << 3
  };

  //---------------------------------------------------------------------
  // QRErrorCorrectionLevel
  //---------------------------------------------------------------------

  var QRErrorCorrectionLevel = {
    L : 1,
    M : 0,
    Q : 3,
    H : 2
  };

  //---------------------------------------------------------------------
  // QRMaskPattern
  //---------------------------------------------------------------------

  var QRMaskPattern = {
    PATTERN000 : 0,
    PATTERN001 : 1,
    PATTERN010 : 2,
    PATTERN011 : 3,
    PATTERN100 : 4,
    PATTERN101 : 5,
    PATTERN110 : 6,
    PATTERN111 : 7
  };

  //---------------------------------------------------------------------
  // QRUtil
  //---------------------------------------------------------------------

  var QRUtil = function() {

    var PATTERN_POSITION_TABLE = [
      [],
      [6, 18],
      [6, 22],
      [6, 26],
      [6, 30],
      [6, 34],
      [6, 22, 38],
      [6, 24, 42],
      [6, 26, 46],
      [6, 28, 50],
      [6, 30, 54],
      [6, 32, 58],
      [6, 34, 62],
      [6, 26, 46, 66],
      [6, 26, 48, 70],
      [6, 26, 50, 74],
      [6, 30, 54, 78],
      [6, 30, 56, 82],
      [6, 30, 58, 86],
      [6, 34, 62, 90],
      [6, 28, 50, 72, 94],
      [6, 26, 50, 74, 98],
      [6, 30, 54, 78, 102],
      [6, 28, 54, 80, 106],
      [6, 32, 58, 84, 110],
      [6, 30, 58, 86, 114],
      [6, 34, 62, 90, 118],
      [6, 26, 50, 74, 98, 122],
      [6, 30, 54, 78, 102, 126],
      [6, 26, 52, 78, 104, 130],
      [6, 30, 56, 82, 108, 134],
      [6, 34, 60, 86, 112, 138],
      [6, 30, 58, 86, 114, 142],
      [6, 34, 62, 90, 118, 146],
      [6, 30, 54, 78, 102, 126, 150],
      [6, 24, 50, 76, 102, 128, 154],
      [6, 28, 54, 80, 106, 132, 158],
      [6, 32, 58, 84, 110, 136, 162],
      [6, 26, 54, 82, 110, 138, 166],
      [6, 30, 58, 86, 114, 142, 170]
    ];
    var G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
    var G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
    var G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

    var _this = {};

    var getBCHDigit = function(data) {
      var digit = 0;
      while (data != 0) {
        digit += 1;
        data >>>= 1;
      }
      return digit;
    };

    _this.getBCHTypeInfo = function(data) {
      var d = data << 10;
      while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
        d ^= (G15 << (getBCHDigit(d) - getBCHDigit(G15) ) );
      }
      return ( (data << 10) | d) ^ G15_MASK;
    };

    _this.getBCHTypeNumber = function(data) {
      var d = data << 12;
      while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
        d ^= (G18 << (getBCHDigit(d) - getBCHDigit(G18) ) );
      }
      return (data << 12) | d;
    };

    _this.getPatternPosition = function(typeNumber) {
      return PATTERN_POSITION_TABLE[typeNumber - 1];
    };

    _this.getMaskFunction = function(maskPattern) {

      switch (maskPattern) {

      case QRMaskPattern.PATTERN000 :
        return function(i, j) { return (i + j) % 2 == 0; };
      case QRMaskPattern.PATTERN001 :
        return function(i, j) { return i % 2 == 0; };
      case QRMaskPattern.PATTERN010 :
        return function(i, j) { return j % 3 == 0; };
      case QRMaskPattern.PATTERN011 :
        return function(i, j) { return (i + j) % 3 == 0; };
      case QRMaskPattern.PATTERN100 :
        return function(i, j) { return (Math.floor(i / 2) + Math.floor(j / 3) ) % 2 == 0; };
      case QRMaskPattern.PATTERN101 :
        return function(i, j) { return (i * j) % 2 + (i * j) % 3 == 0; };
      case QRMaskPattern.PATTERN110 :
        return function(i, j) { return ( (i * j) % 2 + (i * j) % 3) % 2 == 0; };
      case QRMaskPattern.PATTERN111 :
        return function(i, j) { return ( (i * j) % 3 + (i + j) % 2) % 2 == 0; };

      default :
        throw 'bad maskPattern:' + maskPattern;
      }
    };

    _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
      var a = qrPolynomial([1], 0);
      for (var i = 0; i < errorCorrectLength; i += 1) {
        a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0) );
      }
      return a;
    };

    _this.getLengthInBits = function(mode, type) {

      if (1 <= type && type < 10) {

        // 1 - 9

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 10;
        case QRMode.MODE_ALPHA_NUM : return 9;
        case QRMode.MODE_8BIT_BYTE : return 8;
        case QRMode.MODE_KANJI     : return 8;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 27) {

        // 10 - 26

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 12;
        case QRMode.MODE_ALPHA_NUM : return 11;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 10;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 41) {

        // 27 - 40

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 14;
        case QRMode.MODE_ALPHA_NUM : return 13;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 12;
        default :
          throw 'mode:' + mode;
        }

      } else {
        throw 'type:' + type;
      }
    };

    _this.getLostPoint = function(qrcode) {

      var moduleCount = qrcode.getModuleCount();

      var lostPoint = 0;

      // LEVEL1

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount; col += 1) {

          var sameCount = 0;
          var dark = qrcode.isDark(row, col);

          for (var r = -1; r <= 1; r += 1) {

            if (row + r < 0 || moduleCount <= row + r) {
              continue;
            }

            for (var c = -1; c <= 1; c += 1) {

              if (col + c < 0 || moduleCount <= col + c) {
                continue;
              }

              if (r == 0 && c == 0) {
                continue;
              }

              if (dark == qrcode.isDark(row + r, col + c) ) {
                sameCount += 1;
              }
            }
          }

          if (sameCount > 5) {
            lostPoint += (3 + sameCount - 5);
          }
        }
      };

      // LEVEL2

      for (var row = 0; row < moduleCount - 1; row += 1) {
        for (var col = 0; col < moduleCount - 1; col += 1) {
          var count = 0;
          if (qrcode.isDark(row, col) ) count += 1;
          if (qrcode.isDark(row + 1, col) ) count += 1;
          if (qrcode.isDark(row, col + 1) ) count += 1;
          if (qrcode.isDark(row + 1, col + 1) ) count += 1;
          if (count == 0 || count == 4) {
            lostPoint += 3;
          }
        }
      }

      // LEVEL3

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount - 6; col += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row, col + 1)
              &&  qrcode.isDark(row, col + 2)
              &&  qrcode.isDark(row, col + 3)
              &&  qrcode.isDark(row, col + 4)
              && !qrcode.isDark(row, col + 5)
              &&  qrcode.isDark(row, col + 6) ) {
            lostPoint += 40;
          }
        }
      }

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount - 6; row += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row + 1, col)
              &&  qrcode.isDark(row + 2, col)
              &&  qrcode.isDark(row + 3, col)
              &&  qrcode.isDark(row + 4, col)
              && !qrcode.isDark(row + 5, col)
              &&  qrcode.isDark(row + 6, col) ) {
            lostPoint += 40;
          }
        }
      }

      // LEVEL4

      var darkCount = 0;

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount; row += 1) {
          if (qrcode.isDark(row, col) ) {
            darkCount += 1;
          }
        }
      }

      var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
      lostPoint += ratio * 10;

      return lostPoint;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // QRMath
  //---------------------------------------------------------------------

  var QRMath = function() {

    var EXP_TABLE = new Array(256);
    var LOG_TABLE = new Array(256);

    // initialize tables
    for (var i = 0; i < 8; i += 1) {
      EXP_TABLE[i] = 1 << i;
    }
    for (var i = 8; i < 256; i += 1) {
      EXP_TABLE[i] = EXP_TABLE[i - 4]
        ^ EXP_TABLE[i - 5]
        ^ EXP_TABLE[i - 6]
        ^ EXP_TABLE[i - 8];
    }
    for (var i = 0; i < 255; i += 1) {
      LOG_TABLE[EXP_TABLE[i] ] = i;
    }

    var _this = {};

    _this.glog = function(n) {

      if (n < 1) {
        throw 'glog(' + n + ')';
      }

      return LOG_TABLE[n];
    };

    _this.gexp = function(n) {

      while (n < 0) {
        n += 255;
      }

      while (n >= 256) {
        n -= 255;
      }

      return EXP_TABLE[n];
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrPolynomial
  //---------------------------------------------------------------------

  function qrPolynomial(num, shift) {

    if (typeof num.length == 'undefined') {
      throw num.length + '/' + shift;
    }

    var _num = function() {
      var offset = 0;
      while (offset < num.length && num[offset] == 0) {
        offset += 1;
      }
      var _num = new Array(num.length - offset + shift);
      for (var i = 0; i < num.length - offset; i += 1) {
        _num[i] = num[i + offset];
      }
      return _num;
    }();

    var _this = {};

    _this.getAt = function(index) {
      return _num[index];
    };

    _this.getLength = function() {
      return _num.length;
    };

    _this.multiply = function(e) {

      var num = new Array(_this.getLength() + e.getLength() - 1);

      for (var i = 0; i < _this.getLength(); i += 1) {
        for (var j = 0; j < e.getLength(); j += 1) {
          num[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i) ) + QRMath.glog(e.getAt(j) ) );
        }
      }

      return qrPolynomial(num, 0);
    };

    _this.mod = function(e) {

      if (_this.getLength() - e.getLength() < 0) {
        return _this;
      }

      var ratio = QRMath.glog(_this.getAt(0) ) - QRMath.glog(e.getAt(0) );

      var num = new Array(_this.getLength() );
      for (var i = 0; i < _this.getLength(); i += 1) {
        num[i] = _this.getAt(i);
      }

      for (var i = 0; i < e.getLength(); i += 1) {
        num[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i) ) + ratio);
      }

      // recursive call
      return qrPolynomial(num, 0).mod(e);
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // QRRSBlock
  //---------------------------------------------------------------------

  var QRRSBlock = function() {

    var RS_BLOCK_TABLE = [

      // L
      // M
      // Q
      // H

      // 1
      [1, 26, 19],
      [1, 26, 16],
      [1, 26, 13],
      [1, 26, 9],

      // 2
      [1, 44, 34],
      [1, 44, 28],
      [1, 44, 22],
      [1, 44, 16],

      // 3
      [1, 70, 55],
      [1, 70, 44],
      [2, 35, 17],
      [2, 35, 13],

      // 4
      [1, 100, 80],
      [2, 50, 32],
      [2, 50, 24],
      [4, 25, 9],

      // 5
      [1, 134, 108],
      [2, 67, 43],
      [2, 33, 15, 2, 34, 16],
      [2, 33, 11, 2, 34, 12],

      // 6
      [2, 86, 68],
      [4, 43, 27],
      [4, 43, 19],
      [4, 43, 15],

      // 7
      [2, 98, 78],
      [4, 49, 31],
      [2, 32, 14, 4, 33, 15],
      [4, 39, 13, 1, 40, 14],

      // 8
      [2, 121, 97],
      [2, 60, 38, 2, 61, 39],
      [4, 40, 18, 2, 41, 19],
      [4, 40, 14, 2, 41, 15],

      // 9
      [2, 146, 116],
      [3, 58, 36, 2, 59, 37],
      [4, 36, 16, 4, 37, 17],
      [4, 36, 12, 4, 37, 13],

      // 10
      [2, 86, 68, 2, 87, 69],
      [4, 69, 43, 1, 70, 44],
      [6, 43, 19, 2, 44, 20],
      [6, 43, 15, 2, 44, 16],

      // 11
      [4, 101, 81],
      [1, 80, 50, 4, 81, 51],
      [4, 50, 22, 4, 51, 23],
      [3, 36, 12, 8, 37, 13],

      // 12
      [2, 116, 92, 2, 117, 93],
      [6, 58, 36, 2, 59, 37],
      [4, 46, 20, 6, 47, 21],
      [7, 42, 14, 4, 43, 15],

      // 13
      [4, 133, 107],
      [8, 59, 37, 1, 60, 38],
      [8, 44, 20, 4, 45, 21],
      [12, 33, 11, 4, 34, 12],

      // 14
      [3, 145, 115, 1, 146, 116],
      [4, 64, 40, 5, 65, 41],
      [11, 36, 16, 5, 37, 17],
      [11, 36, 12, 5, 37, 13],

      // 15
      [5, 109, 87, 1, 110, 88],
      [5, 65, 41, 5, 66, 42],
      [5, 54, 24, 7, 55, 25],
      [11, 36, 12, 7, 37, 13],

      // 16
      [5, 122, 98, 1, 123, 99],
      [7, 73, 45, 3, 74, 46],
      [15, 43, 19, 2, 44, 20],
      [3, 45, 15, 13, 46, 16],

      // 17
      [1, 135, 107, 5, 136, 108],
      [10, 74, 46, 1, 75, 47],
      [1, 50, 22, 15, 51, 23],
      [2, 42, 14, 17, 43, 15],

      // 18
      [5, 150, 120, 1, 151, 121],
      [9, 69, 43, 4, 70, 44],
      [17, 50, 22, 1, 51, 23],
      [2, 42, 14, 19, 43, 15],

      // 19
      [3, 141, 113, 4, 142, 114],
      [3, 70, 44, 11, 71, 45],
      [17, 47, 21, 4, 48, 22],
      [9, 39, 13, 16, 40, 14],

      // 20
      [3, 135, 107, 5, 136, 108],
      [3, 67, 41, 13, 68, 42],
      [15, 54, 24, 5, 55, 25],
      [15, 43, 15, 10, 44, 16],

      // 21
      [4, 144, 116, 4, 145, 117],
      [17, 68, 42],
      [17, 50, 22, 6, 51, 23],
      [19, 46, 16, 6, 47, 17],

      // 22
      [2, 139, 111, 7, 140, 112],
      [17, 74, 46],
      [7, 54, 24, 16, 55, 25],
      [34, 37, 13],

      // 23
      [4, 151, 121, 5, 152, 122],
      [4, 75, 47, 14, 76, 48],
      [11, 54, 24, 14, 55, 25],
      [16, 45, 15, 14, 46, 16],

      // 24
      [6, 147, 117, 4, 148, 118],
      [6, 73, 45, 14, 74, 46],
      [11, 54, 24, 16, 55, 25],
      [30, 46, 16, 2, 47, 17],

      // 25
      [8, 132, 106, 4, 133, 107],
      [8, 75, 47, 13, 76, 48],
      [7, 54, 24, 22, 55, 25],
      [22, 45, 15, 13, 46, 16],

      // 26
      [10, 142, 114, 2, 143, 115],
      [19, 74, 46, 4, 75, 47],
      [28, 50, 22, 6, 51, 23],
      [33, 46, 16, 4, 47, 17],

      // 27
      [8, 152, 122, 4, 153, 123],
      [22, 73, 45, 3, 74, 46],
      [8, 53, 23, 26, 54, 24],
      [12, 45, 15, 28, 46, 16],

      // 28
      [3, 147, 117, 10, 148, 118],
      [3, 73, 45, 23, 74, 46],
      [4, 54, 24, 31, 55, 25],
      [11, 45, 15, 31, 46, 16],

      // 29
      [7, 146, 116, 7, 147, 117],
      [21, 73, 45, 7, 74, 46],
      [1, 53, 23, 37, 54, 24],
      [19, 45, 15, 26, 46, 16],

      // 30
      [5, 145, 115, 10, 146, 116],
      [19, 75, 47, 10, 76, 48],
      [15, 54, 24, 25, 55, 25],
      [23, 45, 15, 25, 46, 16],

      // 31
      [13, 145, 115, 3, 146, 116],
      [2, 74, 46, 29, 75, 47],
      [42, 54, 24, 1, 55, 25],
      [23, 45, 15, 28, 46, 16],

      // 32
      [17, 145, 115],
      [10, 74, 46, 23, 75, 47],
      [10, 54, 24, 35, 55, 25],
      [19, 45, 15, 35, 46, 16],

      // 33
      [17, 145, 115, 1, 146, 116],
      [14, 74, 46, 21, 75, 47],
      [29, 54, 24, 19, 55, 25],
      [11, 45, 15, 46, 46, 16],

      // 34
      [13, 145, 115, 6, 146, 116],
      [14, 74, 46, 23, 75, 47],
      [44, 54, 24, 7, 55, 25],
      [59, 46, 16, 1, 47, 17],

      // 35
      [12, 151, 121, 7, 152, 122],
      [12, 75, 47, 26, 76, 48],
      [39, 54, 24, 14, 55, 25],
      [22, 45, 15, 41, 46, 16],

      // 36
      [6, 151, 121, 14, 152, 122],
      [6, 75, 47, 34, 76, 48],
      [46, 54, 24, 10, 55, 25],
      [2, 45, 15, 64, 46, 16],

      // 37
      [17, 152, 122, 4, 153, 123],
      [29, 74, 46, 14, 75, 47],
      [49, 54, 24, 10, 55, 25],
      [24, 45, 15, 46, 46, 16],

      // 38
      [4, 152, 122, 18, 153, 123],
      [13, 74, 46, 32, 75, 47],
      [48, 54, 24, 14, 55, 25],
      [42, 45, 15, 32, 46, 16],

      // 39
      [20, 147, 117, 4, 148, 118],
      [40, 75, 47, 7, 76, 48],
      [43, 54, 24, 22, 55, 25],
      [10, 45, 15, 67, 46, 16],

      // 40
      [19, 148, 118, 6, 149, 119],
      [18, 75, 47, 31, 76, 48],
      [34, 54, 24, 34, 55, 25],
      [20, 45, 15, 61, 46, 16]
    ];

    var qrRSBlock = function(totalCount, dataCount) {
      var _this = {};
      _this.totalCount = totalCount;
      _this.dataCount = dataCount;
      return _this;
    };

    var _this = {};

    var getRsBlockTable = function(typeNumber, errorCorrectionLevel) {

      switch(errorCorrectionLevel) {
      case QRErrorCorrectionLevel.L :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
      case QRErrorCorrectionLevel.M :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
      case QRErrorCorrectionLevel.Q :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
      case QRErrorCorrectionLevel.H :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
      default :
        return undefined;
      }
    };

    _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {

      var rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);

      if (typeof rsBlock == 'undefined') {
        throw 'bad rs block @ typeNumber:' + typeNumber +
            '/errorCorrectionLevel:' + errorCorrectionLevel;
      }

      var length = rsBlock.length / 3;

      var list = [];

      for (var i = 0; i < length; i += 1) {

        var count = rsBlock[i * 3 + 0];
        var totalCount = rsBlock[i * 3 + 1];
        var dataCount = rsBlock[i * 3 + 2];

        for (var j = 0; j < count; j += 1) {
          list.push(qrRSBlock(totalCount, dataCount) );
        }
      }

      return list;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrBitBuffer
  //---------------------------------------------------------------------

  var qrBitBuffer = function() {

    var _buffer = [];
    var _length = 0;

    var _this = {};

    _this.getBuffer = function() {
      return _buffer;
    };

    _this.getAt = function(index) {
      var bufIndex = Math.floor(index / 8);
      return ( (_buffer[bufIndex] >>> (7 - index % 8) ) & 1) == 1;
    };

    _this.put = function(num, length) {
      for (var i = 0; i < length; i += 1) {
        _this.putBit( ( (num >>> (length - i - 1) ) & 1) == 1);
      }
    };

    _this.getLengthInBits = function() {
      return _length;
    };

    _this.putBit = function(bit) {

      var bufIndex = Math.floor(_length / 8);
      if (_buffer.length <= bufIndex) {
        _buffer.push(0);
      }

      if (bit) {
        _buffer[bufIndex] |= (0x80 >>> (_length % 8) );
      }

      _length += 1;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrNumber
  //---------------------------------------------------------------------

  var qrNumber = function(data) {

    var _mode = QRMode.MODE_NUMBER;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var data = _data;

      var i = 0;

      while (i + 2 < data.length) {
        buffer.put(strToNum(data.substring(i, i + 3) ), 10);
        i += 3;
      }

      if (i < data.length) {
        if (data.length - i == 1) {
          buffer.put(strToNum(data.substring(i, i + 1) ), 4);
        } else if (data.length - i == 2) {
          buffer.put(strToNum(data.substring(i, i + 2) ), 7);
        }
      }
    };

    var strToNum = function(s) {
      var num = 0;
      for (var i = 0; i < s.length; i += 1) {
        num = num * 10 + chatToNum(s.charAt(i) );
      }
      return num;
    };

    var chatToNum = function(c) {
      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      }
      throw 'illegal char :' + c;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrAlphaNum
  //---------------------------------------------------------------------

  var qrAlphaNum = function(data) {

    var _mode = QRMode.MODE_ALPHA_NUM;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var s = _data;

      var i = 0;

      while (i + 1 < s.length) {
        buffer.put(
          getCode(s.charAt(i) ) * 45 +
          getCode(s.charAt(i + 1) ), 11);
        i += 2;
      }

      if (i < s.length) {
        buffer.put(getCode(s.charAt(i) ), 6);
      }
    };

    var getCode = function(c) {

      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      } else if ('A' <= c && c <= 'Z') {
        return c.charCodeAt(0) - 'A'.charCodeAt(0) + 10;
      } else {
        switch (c) {
        case ' ' : return 36;
        case '$' : return 37;
        case '%' : return 38;
        case '*' : return 39;
        case '+' : return 40;
        case '-' : return 41;
        case '.' : return 42;
        case '/' : return 43;
        case ':' : return 44;
        default :
          throw 'illegal char :' + c;
        }
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qr8BitByte
  //---------------------------------------------------------------------

  var qr8BitByte = function(data) {

    var _mode = QRMode.MODE_8BIT_BYTE;
    var _data = data;
    var _bytes = qrcode.stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _bytes.length;
    };

    _this.write = function(buffer) {
      for (var i = 0; i < _bytes.length; i += 1) {
        buffer.put(_bytes[i], 8);
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrKanji
  //---------------------------------------------------------------------

  var qrKanji = function(data) {

    var _mode = QRMode.MODE_KANJI;
    var _data = data;

    var stringToBytes = qrcode.stringToBytesFuncs['SJIS'];
    if (!stringToBytes) {
      throw 'sjis not supported.';
    }
    !function(c, code) {
      // self test for sjis support.
      var test = stringToBytes(c);
      if (test.length != 2 || ( (test[0] << 8) | test[1]) != code) {
        throw 'sjis not supported.';
      }
    }('\u53cb', 0x9746);

    var _bytes = stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return ~~(_bytes.length / 2);
    };

    _this.write = function(buffer) {

      var data = _bytes;

      var i = 0;

      while (i + 1 < data.length) {

        var c = ( (0xff & data[i]) << 8) | (0xff & data[i + 1]);

        if (0x8140 <= c && c <= 0x9FFC) {
          c -= 0x8140;
        } else if (0xE040 <= c && c <= 0xEBBF) {
          c -= 0xC140;
        } else {
          throw 'illegal char at ' + (i + 1) + '/' + c;
        }

        c = ( (c >>> 8) & 0xff) * 0xC0 + (c & 0xff);

        buffer.put(c, 13);

        i += 2;
      }

      if (i < data.length) {
        throw 'illegal char at ' + (i + 1);
      }
    };

    return _this;
  };

  //=====================================================================
  // GIF Support etc.
  //

  //---------------------------------------------------------------------
  // byteArrayOutputStream
  //---------------------------------------------------------------------

  var byteArrayOutputStream = function() {

    var _bytes = [];

    var _this = {};

    _this.writeByte = function(b) {
      _bytes.push(b & 0xff);
    };

    _this.writeShort = function(i) {
      _this.writeByte(i);
      _this.writeByte(i >>> 8);
    };

    _this.writeBytes = function(b, off, len) {
      off = off || 0;
      len = len || b.length;
      for (var i = 0; i < len; i += 1) {
        _this.writeByte(b[i + off]);
      }
    };

    _this.writeString = function(s) {
      for (var i = 0; i < s.length; i += 1) {
        _this.writeByte(s.charCodeAt(i) );
      }
    };

    _this.toByteArray = function() {
      return _bytes;
    };

    _this.toString = function() {
      var s = '';
      s += '[';
      for (var i = 0; i < _bytes.length; i += 1) {
        if (i > 0) {
          s += ',';
        }
        s += _bytes[i];
      }
      s += ']';
      return s;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64EncodeOutputStream
  //---------------------------------------------------------------------

  var base64EncodeOutputStream = function() {

    var _buffer = 0;
    var _buflen = 0;
    var _length = 0;
    var _base64 = '';

    var _this = {};

    var writeEncoded = function(b) {
      _base64 += String.fromCharCode(encode(b & 0x3f) );
    };

    var encode = function(n) {
      if (n < 0) {
        // error.
      } else if (n < 26) {
        return 0x41 + n;
      } else if (n < 52) {
        return 0x61 + (n - 26);
      } else if (n < 62) {
        return 0x30 + (n - 52);
      } else if (n == 62) {
        return 0x2b;
      } else if (n == 63) {
        return 0x2f;
      }
      throw 'n:' + n;
    };

    _this.writeByte = function(n) {

      _buffer = (_buffer << 8) | (n & 0xff);
      _buflen += 8;
      _length += 1;

      while (_buflen >= 6) {
        writeEncoded(_buffer >>> (_buflen - 6) );
        _buflen -= 6;
      }
    };

    _this.flush = function() {

      if (_buflen > 0) {
        writeEncoded(_buffer << (6 - _buflen) );
        _buffer = 0;
        _buflen = 0;
      }

      if (_length % 3 != 0) {
        // padding
        var padlen = 3 - _length % 3;
        for (var i = 0; i < padlen; i += 1) {
          _base64 += '=';
        }
      }
    };

    _this.toString = function() {
      return _base64;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64DecodeInputStream
  //---------------------------------------------------------------------

  var base64DecodeInputStream = function(str) {

    var _str = str;
    var _pos = 0;
    var _buffer = 0;
    var _buflen = 0;

    var _this = {};

    _this.read = function() {

      while (_buflen < 8) {

        if (_pos >= _str.length) {
          if (_buflen == 0) {
            return -1;
          }
          throw 'unexpected end of file./' + _buflen;
        }

        var c = _str.charAt(_pos);
        _pos += 1;

        if (c == '=') {
          _buflen = 0;
          return -1;
        } else if (c.match(/^\s$/) ) {
          // ignore if whitespace.
          continue;
        }

        _buffer = (_buffer << 6) | decode(c.charCodeAt(0) );
        _buflen += 6;
      }

      var n = (_buffer >>> (_buflen - 8) ) & 0xff;
      _buflen -= 8;
      return n;
    };

    var decode = function(c) {
      if (0x41 <= c && c <= 0x5a) {
        return c - 0x41;
      } else if (0x61 <= c && c <= 0x7a) {
        return c - 0x61 + 26;
      } else if (0x30 <= c && c <= 0x39) {
        return c - 0x30 + 52;
      } else if (c == 0x2b) {
        return 62;
      } else if (c == 0x2f) {
        return 63;
      } else {
        throw 'c:' + c;
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // gifImage (B/W)
  //---------------------------------------------------------------------

  var gifImage = function(width, height) {

    var _width = width;
    var _height = height;
    var _data = new Array(width * height);

    var _this = {};

    _this.setPixel = function(x, y, pixel) {
      _data[y * _width + x] = pixel;
    };

    _this.write = function(out) {

      //---------------------------------
      // GIF Signature

      out.writeString('GIF87a');

      //---------------------------------
      // Screen Descriptor

      out.writeShort(_width);
      out.writeShort(_height);

      out.writeByte(0x80); // 2bit
      out.writeByte(0);
      out.writeByte(0);

      //---------------------------------
      // Global Color Map

      // black
      out.writeByte(0x00);
      out.writeByte(0x00);
      out.writeByte(0x00);

      // white
      out.writeByte(0xff);
      out.writeByte(0xff);
      out.writeByte(0xff);

      //---------------------------------
      // Image Descriptor

      out.writeString(',');
      out.writeShort(0);
      out.writeShort(0);
      out.writeShort(_width);
      out.writeShort(_height);
      out.writeByte(0);

      //---------------------------------
      // Local Color Map

      //---------------------------------
      // Raster Data

      var lzwMinCodeSize = 2;
      var raster = getLZWRaster(lzwMinCodeSize);

      out.writeByte(lzwMinCodeSize);

      var offset = 0;

      while (raster.length - offset > 255) {
        out.writeByte(255);
        out.writeBytes(raster, offset, 255);
        offset += 255;
      }

      out.writeByte(raster.length - offset);
      out.writeBytes(raster, offset, raster.length - offset);
      out.writeByte(0x00);

      //---------------------------------
      // GIF Terminator
      out.writeString(';');
    };

    var bitOutputStream = function(out) {

      var _out = out;
      var _bitLength = 0;
      var _bitBuffer = 0;

      var _this = {};

      _this.write = function(data, length) {

        if ( (data >>> length) != 0) {
          throw 'length over';
        }

        while (_bitLength + length >= 8) {
          _out.writeByte(0xff & ( (data << _bitLength) | _bitBuffer) );
          length -= (8 - _bitLength);
          data >>>= (8 - _bitLength);
          _bitBuffer = 0;
          _bitLength = 0;
        }

        _bitBuffer = (data << _bitLength) | _bitBuffer;
        _bitLength = _bitLength + length;
      };

      _this.flush = function() {
        if (_bitLength > 0) {
          _out.writeByte(_bitBuffer);
        }
      };

      return _this;
    };

    var getLZWRaster = function(lzwMinCodeSize) {

      var clearCode = 1 << lzwMinCodeSize;
      var endCode = (1 << lzwMinCodeSize) + 1;
      var bitLength = lzwMinCodeSize + 1;

      // Setup LZWTable
      var table = lzwTable();

      for (var i = 0; i < clearCode; i += 1) {
        table.add(String.fromCharCode(i) );
      }
      table.add(String.fromCharCode(clearCode) );
      table.add(String.fromCharCode(endCode) );

      var byteOut = byteArrayOutputStream();
      var bitOut = bitOutputStream(byteOut);

      // clear code
      bitOut.write(clearCode, bitLength);

      var dataIndex = 0;

      var s = String.fromCharCode(_data[dataIndex]);
      dataIndex += 1;

      while (dataIndex < _data.length) {

        var c = String.fromCharCode(_data[dataIndex]);
        dataIndex += 1;

        if (table.contains(s + c) ) {

          s = s + c;

        } else {

          bitOut.write(table.indexOf(s), bitLength);

          if (table.size() < 0xfff) {

            if (table.size() == (1 << bitLength) ) {
              bitLength += 1;
            }

            table.add(s + c);
          }

          s = c;
        }
      }

      bitOut.write(table.indexOf(s), bitLength);

      // end code
      bitOut.write(endCode, bitLength);

      bitOut.flush();

      return byteOut.toByteArray();
    };

    var lzwTable = function() {

      var _map = {};
      var _size = 0;

      var _this = {};

      _this.add = function(key) {
        if (_this.contains(key) ) {
          throw 'dup key:' + key;
        }
        _map[key] = _size;
        _size += 1;
      };

      _this.size = function() {
        return _size;
      };

      _this.indexOf = function(key) {
        return _map[key];
      };

      _this.contains = function(key) {
        return typeof _map[key] != 'undefined';
      };

      return _this;
    };

    return _this;
  };

  var createDataURL = function(width, height, getPixel) {
    var gif = gifImage(width, height);
    for (var y = 0; y < height; y += 1) {
      for (var x = 0; x < width; x += 1) {
        gif.setPixel(x, y, getPixel(x, y) );
      }
    }

    var b = byteArrayOutputStream();
    gif.write(b);

    var base64 = base64EncodeOutputStream();
    var bytes = b.toByteArray();
    for (var i = 0; i < bytes.length; i += 1) {
      base64.writeByte(bytes[i]);
    }
    base64.flush();

    return 'data:image/gif;base64,' + base64;
  };

  //---------------------------------------------------------------------
  // returns qrcode function.

  return qrcode;
}();

// multibyte support
!function() {

  qrcode.stringToBytesFuncs['UTF-8'] = function(s) {
    // http://stackoverflow.com/questions/18729405/how-to-convert-utf8-string-to-byte-array
    function toUTF8Array(str) {
      var utf8 = [];
      for (var i=0; i < str.length; i++) {
        var charcode = str.charCodeAt(i);
        if (charcode < 0x80) utf8.push(charcode);
        else if (charcode < 0x800) {
          utf8.push(0xc0 | (charcode >> 6),
              0x80 | (charcode & 0x3f));
        }
        else if (charcode < 0xd800 || charcode >= 0xe000) {
          utf8.push(0xe0 | (charcode >> 12),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
        // surrogate pair
        else {
          i++;
          // UTF-16 encodes 0x10000-0x10FFFF by
          // subtracting 0x10000 and splitting the
          // 20 bits of 0x0-0xFFFFF into two halves
          charcode = 0x10000 + (((charcode & 0x3ff)<<10)
            | (str.charCodeAt(i) & 0x3ff));
          utf8.push(0xf0 | (charcode >>18),
              0x80 | ((charcode>>12) & 0x3f),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
      }
      return utf8;
    }
    return toUTF8Array(s);
  };

}();

(function (factory) {
  if (typeof define === 'function' && define.amd) {
      define([], factory);
  } else if (typeof exports === 'object') {
      module.exports = factory();
  }
}(function () {
    return qrcode;
}));

/* ================================================================
 AI Chat Widget — Agent tool registry (50+ tools) + Pyodide sandbox.
 Prepended to chat.js (same IIFE scope, plain top-level script).
 Adds: TOOL_LIB (execution) + TOOL_SCHEMAS (OpenAI tool schema) +
 Pyodide-backed run_python. See chat.js for the agent loops that
 consume these (executeTool delegates to TOOL_LIB).
 ================================================================ */

  // ---- Tool registry helpers ----
  var TOOL_LIB = {};   // name -> fn(args, ctx) -> result object
  var TOOL_SCHEMAS = []; // {name, description, parameters}

  function tool(def) {
    TOOL_LIB[def.name] = def.fn;
    TOOL_SCHEMAS.push({
      type: "function",
      function: {
        name: def.name,
        description: def.description,
        parameters: def.parameters || { type: "object", properties: {}, required: [] }
      }
    });
  }
  function strParam(d) { return { type: "string", description: d }; }
  function intParam(d) { return { type: "integer", description: d }; }
  function boolParam(d) { return { type: "boolean", description: d }; }
  function strArrParam(d) { return { type: "array", items: { type: "string" }, description: d }; }
  function codeParam() { return strParam("JUPAS (JSxxxx) or non-JUPAS (xxxxA) programme code, e.g. JS1204 or 1561A"); }
  function yearParam() { return intParam("Year, 2023-2026"); }
  function limitParam() { return intParam("Max items to return (default 5, max 10)"); }
  function textParam() { return strParam("Keywords, e.g. \"JUPAS CS admission score\""); }
  function normStr(v) { return String(v == null ? "" : v).trim(); }
  function normList(v) {
    if (Array.isArray(v)) return v.map(normStr).filter(Boolean);
    if (typeof v === "string") return v.split(/[,;]/).map(normStr).filter(Boolean);
    return [];
  }
  function normYears(v) {
    var out = [];
    normList(v).forEach(function (x) {
      var m = x.match(/(20[12]\d)/);
      if (m) out.push(parseInt(m[1], 10));
    });
    if (!out.length) out.push(2026);
    return out;
  }
  function entryByIdx(i) { return (knowledgeIndex && knowledgeIndex[i]) || null; }
  function entriesMatching(code, mode) {
    if (!knowledgeIndex || !code) return [];
    var c = String(code).toUpperCase().replace(/[\s_]+/g, "");
    var out = [];
    for (var i = 0; i < knowledgeIndex.length; i++) {
      var e = knowledgeIndex[i];
      var hay = (e.slug + " " + e.title + " " + e.text);
      var re;
      if (mode === "nonjupas") re = new RegExp("\\b" + c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b");
      else re = new RegExp("[^A-Za-z0-9]?JS" + c.replace(/^JS/, "") + "[^A-Za-z0-9]");
      if (re.test(hay)) out.push(e);
    }
    return out;
  }
  function shortAnswer(entry) {
    // Tip callout: "> [!tip] Short answer" then a blank "> " line, then the
    // answer lines ("> ..."), until the first non-"> " line (e.g. "## Question").
    var text = entry.text || "";
    var lines = text.split("\n");
    var start = -1;
    for (var i = 0; i < lines.length; i++) {
      if (/^>\s*\[!tip\]/.test(lines[i])) { start = i + 1; break; }
    }
    if (start < 0) return "";
    var out = [];
    for (var j = start; j < lines.length; j++) {
      var line = lines[j];
      if (!line.startsWith(">")) break;      // end of the callout
      var content = line.replace(/^>\s?/, "");
      if (content) out.push(content);
    }
    var sa = out.join(" ").replace(/\s+/g, " ").trim();
    return sa;
  }
  // Map full programme names to the abbreviations used in note titles, so
  // lookups like get_nonjupas_code("Computer Science") match "BSc CS ...".
  var PROGRAMME_ALIASES = {
    "computer science": ["computer science", "cs", "comp sci"],
    "cs": ["cs", "computer science"],
    "cybersecurity": ["cybersecurity", "cyber"],
    "data science": ["data science", "ds"],
    "data and systems engineering": ["data and systems engineering", "dse"],
    "computational finance": ["computational finance", "fintech", "fin tech"]
  };
  function programmeVariants(name) {
    var n = String(name || "").toLowerCase().trim();
    var out = [];
    (PROGRAMME_ALIASES[n] || [n]).forEach(function (v) { if (v && out.indexOf(v) < 0) out.push(v); });
    if (n && out.indexOf(n) < 0) out.push(n);
    return out;
  }
  // True if any programme-variant matches `hay` on WORD boundaries (so the
  // alias "ds" matches "BSc DS" but not "...systems...").
  function programmeMatches(hay, variants) {
    var h = String(hay || "").toLowerCase();
    for (var i = 0; i < variants.length; i++) {
      var v = variants[i];
      if (!v) continue;
      var re = new RegExp("\\b" + v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b");
      if (re.test(h)) return true;
    }
    return false;
  }
  function capTitle(t) { return t.replace(/\([^)]*\)/g, "").trim(); }
  // True if a note's folder slug starts with any of `prefixes` (case-insensitive,
  // so "05_Programmes" matches the stored slug "05_programmes"). Pass [] to match all.
  function folderPrefix(folder, prefixes) {
    if (!prefixes || !prefixes.length) return true;
    var f = String(folder || "").toLowerCase();
    for (var i = 0; i < prefixes.length; i++) {
      if (f.indexOf(String(prefixes[i]).toLowerCase()) === 0) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------
  // SEARCH cluster — generic retrieval. Each entry it returns carries
  // `id`; read_note(id) then returns the FULL note text (the snippet
  // alone is often too thin to answer from — that is the main cause of
  // weak answers).
  // ------------------------------------------------------------------
  function searchCore(query, limit, folder, minTitleHits) {
    var q = normStr(query);
    var lim = Math.max(1, Math.min(parseInt(limit, 10) || 5, 10));
    if (!q || !knowledgeIndex) return { ok: false, count: 0, results: [], error: "search_notes needs a non-empty 'query' (e.g. \"JUPAS scholarship\"). Retry with keywords, not an empty string." };
    var terms = q.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter(Boolean);
    if (!terms.length) return { ok: false, count: 0, results: [], error: "No searchable words in that query. Retry with different keywords." };
    // Topic boost: the longest query term (e.g. "scholarship" in
    // "JS1204 Computer Science JUPAS scholarship tier") names the real
    // topic. Doubling notes whose TITLE carries it stops off-topic but
    // keyword-rich notes (e.g. every JS1204 score note) from crowding out
    // the on-topic notes when the model appends the programme code.
    var topic = terms.slice().sort(function (a, b) { return b.length - a.length; })[0] || "";
    var scored = [];
    for (var i = 0; i < knowledgeIndex.length; i++) {
      var e = knowledgeIndex[i];
      if (folder && e.folder !== folder) continue;
      var combined = (e.title + " " + e.text).toLowerCase();
      var titleLower = e.title.toLowerCase();
      var score = 0, titleHits = 0;
      for (var t = 0; t < terms.length; t++) {
        var term = terms[t];
        if (combined.indexOf(term) < 0) continue;
        score += titleLower.indexOf(term) >= 0 ? 10 : 1;
        if (titleLower.indexOf(term) >= 0) titleHits++;
        score += Math.max(0, 5 - combined.indexOf(term) / 100);
      }
      if (topic.length >= 6 && titleLower.indexOf(topic) >= 0) score *= 2;
      if (minTitleHits && titleHits < minTitleHits) continue;
      if (score > 0) scored.push({ e: e, score: score, titleHits: titleHits });
    }
    scored.sort(function (a, b) { return b.score - a.score; });
    var payload = {
      ok: true,
      count: scored.length,
      results: scored.slice(0, lim).map(function (s) {
        return {
          id: knowledgeIndex.indexOf(s.e),
          slug: s.e.slug,
          title: s.e.title,
          folder: s.e.folder,
          score: Math.round(s.score * 10) / 10,
          short_answer: shortAnswer(s.e),
          snippet: answerExcerpt(s.e)
        };
      })
    };
    // The agent loop hard-truncates tool results (TOOL_RESULT_MAX). A cut
    // mid-object makes the model receive INVALID JSON and silently drops
    // the lowest-ranked (often most on-topic) results. Instead, shrink the
    // result set ourselves so the JSON always fits intact: fewer complete
    // results > broken JSON.
    var budget = (typeof TOOL_RESULT_MAX !== "undefined" ? TOOL_RESULT_MAX : 6000) - 200;
    var s = JSON.stringify(payload);
    while (s.length > budget && payload.results.length > 1) {
      payload.results.pop();
      s = JSON.stringify(payload);
    }
    if (payload.results.length < Math.min(lim, scored.length)) {
      payload.truncated = "Fewer results shown to fit the tool-result budget; the top-ranked ones are complete. Use read_note(id) for full text or re-search with a smaller limit.";
    }
    return payload;
  }
  // Excerpt anchored at the note's "## Answer" section (falls back to the
  // start of the text). This is where the actual tables, amounts and
  // thresholds live — a leading slice just re-serves the tip callout that
  // short_answer already covers, wasting the (truncated) tool-result budget
  // and hiding the data the model needs.
  function answerExcerpt(entry) {
    var text = entry.text || "";
    var ai = text.indexOf("## Answer");
    var start = ai >= 0 ? ai : 0;
    var out = text.slice(start, start + 340).replace(/\n{2,}/g, "\n").trim();
    return start > 0 ? "… " + out : out;
  }

  tool({
    name: "search_notes",
    description: "Keyword-search all the CityUHK CS admission FAQ notes. The MAIN lookup tool. Returns ranked results with a 'short_answer' for each — usually enough to answer directly; call read_note(id) for the full text when you need more detail. If the user asks about the CURRENT/THIS page, use read_current_page instead.",
    parameters: {
      type: "object",
      properties: {
        query: textParam(),
        limit: limitParam(),
        folder: strParam("Optional folder prefix to narrow the search, e.g. '07_cityu-scores' (see list_folders)")
      },
      required: ["query"]
    },
    fn: function (a, ctx) {
      var r = searchCore(a.query, a.limit, normStr(a.folder), 0);
      r.hint = r.count ? "You have enough to answer. Use read_note(id) only if a result's short_answer/snippet is insufficient." : "Try fewer/different keywords, or list_folders to find the right section.";
      return r;
    }
  });

  tool({
    name: "search_exact",
    description: "Strict search: a note only matches if EVERY keyword appears in its TITLE (or the whole note for multi-word phrases). Use when search_notes returns too many loosely related notes.",
    parameters: { type: "object", properties: { query: textParam(), limit: limitParam() }, required: ["query"] },
    fn: function (a) {
      var r = searchCore(a.query, a.limit, "", 1);
      r.note = "Only notes whose title contains at least one full keyword are shown; tighten keywords for stricter matching.";
      return r;
    }
  });

  tool({
    name: "find_notes_mentioning",
    description: "Find every note that mentions a specific code, subject, programme, university or number (e.g. 'JS1204', 'Cybersecurity', 'HKU', '47,000'). Returns up to 10 matches with title + short answer.",
    parameters: { type: "object", properties: { term: strParam("The exact word/phrase/code to find in the notes"), limit: limitParam() }, required: ["term"] },
    fn: function (a) {
      var t = normStr(a.term);
      var lim = Math.max(1, Math.min(parseInt(a.limit, 10) || 10, 10));
      if (!t || !knowledgeIndex) return { ok: true, count: 0, results: [] };
      var tl = t.toLowerCase();
      var results = [];
      for (var i = 0; i < knowledgeIndex.length && results.length < lim; i++) {
        var e = knowledgeIndex[i];
        if ((e.title + " " + e.text).toLowerCase().indexOf(tl) >= 0) {
          results.push({ id: i, slug: e.slug, title: e.title, folder: e.folder, short_answer: shortAnswer(e) });
        }
      }
      return { ok: true, count: results.length, results: results };
    }
  });

  // ------------------------------------------------------------------
  // WEB cluster — best-effort internet lookup for topics the vault does NOT
  // cover (job market, salaries, industry news, competitor universities'
  // non-CityU data, general CS knowledge). Calls Wikipedia (en + zh) and
  // DuckDuckGo straight from the browser (both are CORS-open, no proxy /
  // server / API key needed). Used ONLY after search_notes comes up empty —
  // the vault is the source of truth for admission facts; the web is a
  // fallback so the assistant never just says "not in the notes."
  // ------------------------------------------------------------------
  function decodeWikiSnippet(s) {
    return String(s || "")
      .replace(/<[^>]+>/g, "")
      .replace(/&quot;/g, '"').replace(/&amp;/g, "&")
      .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/\s+/g, " ").trim();
  }
  async function wikiSearch(lang, q, lim) {
    var base = "https://" + lang + ".wikipedia.org/w/api.php";
    var url = base + "?action=query&list=search&srsearch=" + encodeURIComponent(q) +
      "&srlimit=" + lim + "&format=json&origin=*";
    var res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    var data = await res.json();
    var rows = (data && data.query && data.query.search) || [];
    return rows.map(function (r) {
      return {
        source: "Wikipedia",
        title: r.title,
        snippet: decodeWikiSnippet(r.snippet),
        url: "https://" + lang + ".wikipedia.org/wiki/" + encodeURIComponent(r.title.replace(/ /g, "_"))
      };
    });
  }
  async function ddgSearch(q, lim) {
    // DuckDuckGo Instant Answer API (CORS-open). Returns topic/abstract/
    // related topics rather than full web results — a good lightweight source.
    var url = "https://api.duckduckgo.com/?q=" + encodeURIComponent(q) + "&format=json&no_html=1&no_redirect=1&skip_disambig=1";
    var res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    var d = await res.json();
    var out = [];
    if (d.AbstractText) out.push({ source: "DuckDuckGo", title: d.Heading || q, snippet: String(d.AbstractText), url: d.AbstractURL || "" });
    ((d.RelatedTopics) || []).slice(0, lim).forEach(function (t) {
      var item = t.FirstURL ? t : (t.Topics && t.Topics[0]);
      if (!item || !item.Text) return;
      out.push({ source: "DuckDuckGo", title: item.Text.split(" - ")[0], snippet: item.Text, url: item.FirstURL || "" });
    });
    return out;
  }

  tool({
    name: "web_search",
    description: "Search the INTERNET (Wikipedia + DuckDuckGo) for information the site's notes do NOT cover — e.g. CS job market / salaries / demand in Hong Kong, industry trends, what a CS graduate does, general CS concepts. Use this as a FALLBACK when search_notes returns nothing or clearly lacks the answer, so you can still give a best-effort answer instead of just saying 'not in the notes'. Always frame web results as general knowledge (cite the source title), and note the site's own admission data is authoritative for CityU facts.",
    parameters: {
      type: "object",
      properties: {
        query: textParam("Web search keywords, e.g. \"Hong Kong computer science graduate salary job market\""),
        limit: limitParam()
      },
      required: ["query"]
    },
    fn: async function (a) {
      var q = normStr(a.query);
      var lim = Math.max(1, Math.min(parseInt(a.limit, 10) || 5, 8));
      if (!q) return { ok: false, error: "web_search needs a non-empty 'query'." };
      var results = [];
      var errors = [];
      // Run Wikipedia (en + zh) and DuckDuckGo concurrently; tolerate any one
      // failing (offline / blocked) and return what we got.
      try {
        var en = await wikiSearch("en", q, lim);
        results = results.concat(en);
      } catch (e) { errors.push("wikipedia-en: " + (e && e.message ? e.message : e)); }
      try {
        var zh = await wikiSearch("zh", q, Math.max(2, Math.floor(lim / 2)));
        results = results.concat(zh);
      } catch (e) { errors.push("wikipedia-zh: " + (e && e.message ? e.message : e)); }
      try {
        var ddg = await ddgSearch(q, Math.max(2, Math.floor(lim / 2)));
        results = results.concat(ddg);
      } catch (e) { errors.push("duckduckgo: " + (e && e.message ? e.message : e)); }
      // De-dupe by (source+title), cap to limit.
      var seen = {}, out = [];
      for (var i = 0; i < results.length && out.length < lim; i++) {
        var r = results[i];
        if (!r || !r.snippet) continue;
        var k = r.source + "|" + r.title;
        if (seen[k]) continue;
        seen[k] = true;
        out.push(r);
      }
      if (!out.length) {
        return {
          ok: false,
          error: "No web results (sources unreachable or no matches)." + (errors.length ? " (" + errors.join("; ") + ")" : ""),
          hint: "If the internet is blocked in the user's browser, fall back to answering from the site notes or say you could not verify."
        };
      }
      return {
        ok: true,
        count: out.length,
        results: out,
        caveat: "General web knowledge (Wikipedia / DuckDuckGo), NOT CityU's official admission data. Cite the source title(s); for CityU-specific admission facts the site notes are authoritative."
      };
    }
  });

  tool({
    name: "list_folders",
    description: "List the site's note sections (folders) with note counts. Use to discover what topics exist before searching, or when a search returns nothing.",
    parameters: { type: "object", properties: {}, required: [] },
    fn: function () {
      if (!knowledgeIndex) return { ok: false, error: "index not loaded" };
      var counts = {}, names = {};
      for (var i = 0; i < knowledgeIndex.length; i++) {
        var f = knowledgeIndex[i].folder || "(root)";
        counts[f] = (counts[f] || 0) + 1;
        names[f] = knowledgeIndex[i].title;
      }
      var out = Object.keys(counts).sort().map(function (f) { return { folder: f, notes: counts[f], example: names[f] }; });
      return { ok: true, sections: out };
    }
  });

  tool({
    name: "list_notes",
    description: "List note titles (with ids and slugs) in a folder or matching a title keyword. Cheap way to browse a section (e.g. all 2026 CityU score notes, all courses) without reading their content.",
    parameters: {
      type: "object",
      properties: {
        folder: strParam("Folder prefix, e.g. '07_cityu-scores'"),
        title_contains: strParam("Only titles containing this text (case-insensitive)"),
        limit: limitParam()
      },
      required: []
    },
    fn: function (a) {
      var f = normStr(a.folder), tc = normStr(a.title_contains).toLowerCase();
      var lim = Math.max(1, Math.min(parseInt(a.limit, 10) || 25, 50));
      var out = [];
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var e = knowledgeIndex[i];
        if (f && e.folder !== f) continue;
        if (tc && e.title.toLowerCase().indexOf(tc) < 0) continue;
        out.push({ id: i, slug: e.slug, title: e.title });
        if (out.length >= lim) break;
      }
      return { ok: true, count: out.length, notes: out, hint: "Use read_note(id) to read the full text of any listed note." };
    }
  });

  tool({
    name: "read_note",
    description: "Return the full text of one note by the id (or slug) from search_notes / list_notes / find_notes_mentioning. Use when the returned snippet or short_answer is not enough to answer accurately — this is how you get complete details (tables, dates, conditions, full requirement lists) without navigating the user's page. For a LONG note, pass offset to read the part you have not seen yet (the result's `next_offset` tells you where to continue), or section to jump straight to a heading (e.g. 'Answer', 'Requirements', 'Examples').",
    parameters: {
      type: "object",
      properties: {
        id: intParam("Note id from a search/list result"),
        slug: strParam("Or the note slug"),
        offset: intParam("Character position to start from (default 0). Use the previous result's next_offset to continue."),
        max_chars: intParam("Max characters to return (default 2200, max 6000)"),
        section: strParam("Optional: start at the heading containing this text (e.g. 'Answer', 'Requirements', 'Examples')")
      },
      required: []
    },
    fn: function (a, ctx) {
      var e = null;
      if (a.id != null) e = entryByIdx(parseInt(a.id, 10));
      else if (normStr(a.slug)) { for (var i = 0; i < (knowledgeIndex || []).length; i++) if (knowledgeIndex[i].slug === normStr(a.slug)) { e = knowledgeIndex[i]; break; } }
      if (!e) return { ok: false, error: "No note with that id/slug. Call search_notes or list_notes first." };
      var text = e.text || "";
      var off = Math.max(0, parseInt(a.offset, 10) || 0);
      var max = Math.min(parseInt(a.max_chars, 10) || 2200, 6000);
      // section: jump to the first heading ("##"/"###") whose text contains the
      // term, so "section: Requirements" skips straight to that part of a long note.
      if (a.section) {
        var term = String(a.section).toLowerCase();
        var headingRe = /^#{2,6}\s+[^\n]*$/gm;
        var hm, bestAt = -1;
        while ((hm = headingRe.exec(text))) {
          if (hm[0].toLowerCase().indexOf(term) >= 0) { bestAt = hm.index; break; }
        }
        if (bestAt >= 0) off = bestAt;
      }
      if (off > text.length) off = text.length;
      var slice = text.slice(off, off + max);
      var nextOffset = off + slice.length;
      var out = { ok: true, id: knowledgeIndex.indexOf(e), slug: e.slug, title: e.title, text: slice };
      if (nextOffset < text.length) {
        out.truncated = true;
        out.next_offset = nextOffset;
        out.total_chars = text.length;
        out.more = "Note continues — call read_note again with offset=" + nextOffset + " (or a smaller max_chars) to read the rest.";
      }
      return out;
    }
  });

  // ------------------------------------------------------------------
  // PROGRAMME & CODE cluster — structured lookups over the vault's
  // code tables (cheat sheet, per-code overview/score/fee notes).
  // ------------------------------------------------------------------
  function jupasCodesFromCheatSheet() {
    for (var i = 0; i < (knowledgeIndex || []).length; i++) {
      var e = knowledgeIndex[i];
      if (e.slug.indexOf("code-cheat-sheet") >= 0 && /JS\d{4}/.test(e.text)) {
        var rows = [];
        var re = /\|\s*(JS\d{4})\s*\|\s*([^|\n]+)\|/g, m;
        while ((m = re.exec(e.text)) && rows.length < 20) {
          var prog = m[2].trim();
          var route = e.text.slice(m.index).split("\n")[0].split("|").pop() || "";
          rows.push({ code: m[1], programme: prog, route: route.trim() || "JUPAS" });
        }
        if (rows.length) return rows;
      }
    }
    return null;
  }

  tool({
    name: "get_jupas_code",
    description: "Return the JUPAS code(s) for a CityUHK CS programme (e.g. 'computer science', 'cybersecurity', 'data science', 'double degree'). Use this when the user asks for a JUPAS code. Also use it to LIST all JUPAS codes when no programme is given.",
    parameters: { type: "object", properties: { programme: strParam("Programme name, e.g. 'Computer Science'; leave empty to list all") }, required: [] },
    fn: function (a) {
      var want = normStr(a.programme).toLowerCase();
      var all = jupasCodesFromCheatSheet();
      if (!all) return { ok: false, error: "Programme code table not found. Use search_notes instead." };
      if (!want) return { ok: true, codes: all, hint: "These are ALL CityUHK CS JUPAS codes. Cite them with their programme names." };
      var variants = programmeVariants(want);
      var hits = all.filter(function (r) {
        return programmeMatches(r.programme, variants) ||
          want.split(/\s+/).every(function (w) { return r.programme.toLowerCase().indexOf(w) >= 0; });
      });
      if (!hits.length) hits = all.filter(function (r) { return want.split(/\s+/).some(function (w) { return w.length > 3 && r.programme.toLowerCase().indexOf(w) >= 0; }); });
      return { ok: true, codes: hits.length ? hits : all, matched: hits.length > 0, hint: hits.length ? "" : "No exact programme match — here are all CS JUPAS codes to pick from." };
    }
  });

  tool({
    name: "get_nonjupas_code",
    description: "Return the non-JUPAS admission code(s) for a CityUHK CS programme (e.g. 1561A for BSc CS). Use when the user asks for a non-JUPAS / direct-application code, or the application fee / advanced-standing route.",
    parameters: { type: "object", properties: { programme: strParam("Programme name, e.g. 'Computer Science'; leave empty to list all") }, required: [] },
    fn: function (a) {
      var want = normStr(a.programme);
      var variants = want ? programmeVariants(want) : [];
      var out = [];
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var e = knowledgeIndex[i];
        if (e.folder !== "03_nonjupas") continue;
        var m = e.title.match(/Code\s+([0-9]{4}[A-Z])/i);
        if (!m) continue;
        var prog = e.title.replace(/Non-JUPAS Code [0-9A-Z]+/i, "").replace(/\bBSc\b/g, "").trim();
        var hay = (e.title + " " + e.text).toLowerCase();
        var match = !want || programmeMatches(e.title + " " + e.text, variants);
        if (match) out.push({ code: m[1], programme: prog, note_title: e.title, note_id: i });
      }
      if (!out.length) return { ok: false, error: "No non-JUPAS code note found for that programme. Try search_notes." };
      return { ok: true, codes: out, hint: "Application fee and advanced-standing details: read_note(id) on a listed note." };
    }
  });

  tool({
    name: "get_programme_info",
    description: "Get programme profiles from their overview notes: what they are, streams/majors, duration, and the note's short answer. The single best first call when the user asks about a programme by name or code. Pass code='all' (or a broad name like 'double degree') to list EVERY matching programme note at once.",
    parameters: { type: "object", properties: { code: codeParam(), name: strParam("Or the programme name, e.g. 'BSc Data Science'; 'double degree' lists all double degrees") }, required: [] },
    fn: function (a) {
      var code = normStr(a.code), name = normStr(a.name);
      var variants = name ? programmeVariants(name) : [];
      var all = [];
      var wantAll = !code && !name || /^(all|list|every|all of them)$/i.test(code) || /^(all|list|every)$/i.test(name);
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var n = knowledgeIndex[i];
        if (n.folder !== "05_programmes") continue;
        if (wantAll) { all.push(n); continue; }
        var isCode = code && (new RegExp("\\b" + code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(n.slug + " " + n.title));
        var isName = name && (programmeMatches(n.title, variants) || programmeMatches(n.title + " " + n.text.slice(0, 200), variants));
        // Broad ask ("all", "double degree", "double") -> match every overview
        // note whose title carries the topic word(s). "double degree" is two
        // words, so word-boundary matching on the whole phrase would miss the
        // titles ("...Double Degree Overview"); match per topic word instead.
        var isBroad = false;
        if (name && /^(all|list|every|each|double(\s+degrees?)?(\s+and\s+\w+)*|\w+\s+(degree|degrees))$/i.test(name)) {
          var wts = name.toLowerCase().split(/\s+/).filter(function (w) { return w.length > 3 && w !== "degree" && w !== "degrees"; });
          if (wts.length) {
            var tl = n.title.toLowerCase();
            var wmatch = wts.filter(function (w) { return new RegExp("\\b" + w + "\\b").test(tl); }).length;
            isBroad = wmatch >= Math.ceil(wts.length / 2);
          }
        }
        if (isCode || isName || isBroad) all.push(n);
      }
      if (!all.length) {
        // Never fail blind: hand back the catalogue of codes so the model (or user) can pick.
        var known = [];
        for (var j = 0; j < (knowledgeIndex || []).length; j++) {
          var k = knowledgeIndex[j];
          if (k.folder !== "05_programmes") continue;
          var cm = k.title.match(/(JS\d{4})/);
          known.push(cm ? cm[1] + " " + k.title.replace(cm[1], "").trim() : k.title);
        }
        return { ok: false, error: "No programme note for that code/name.", known_codes: known.slice(0, 12), hint: "Pick a code from known_codes, or use search_notes." };
      }
      var first = all[0];
      if (all.length > 1) {
        // Multi-match: a compact list (full summaries for 14 notes would blow the budget).
        return {
          ok: true,
          matched: all.length,
          programmes: all.slice(0, 14).map(function (x) {
            return { id: knowledgeIndex.indexOf(x), title: x.title, short_answer: shortAnswer(x).slice(0, 220) };
          }),
          more: "Full text of any one via read_note(id)."
        };
      }
      return {
        ok: true,
        matched: all.length,
        id: knowledgeIndex.indexOf(first),
        slug: first.slug,
        title: first.title,
        short_answer: shortAnswer(first),
        summary: first.text.slice(0, 1200),
        more: "Full text via read_note(id)." + (all.length > 1 ? " Also matched: " + all.slice(1).map(function (x) { return x.title + " (id " + knowledgeIndex.indexOf(x) + ")"; }).join("; ") + "." : "")
      };
    }
  });

  tool({
    name: "list_all_programmes",
    description: "List every CityUHK CS programme note (title + id + code if present). Use to answer 'what programmes does CityUHK CS offer?' or to find the exact name before get_programme_info.",
    parameters: { type: "object", properties: { limit: limitParam() }, required: [] },
    fn: function (a) {
      var lim = Math.max(1, Math.min(parseInt(a.limit, 10) || 15, 30));
      var out = [];
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var e = knowledgeIndex[i];
        if (e.folder !== "05_programmes") continue;
        var m = e.title.match(/(JS\d{4}|[0-9]{4}[A-Z])/);
        out.push({ id: i, title: e.title, code: m ? m[1] : null });
        if (out.length >= lim) break;
      }
      return { ok: true, count: out.length, programmes: out };
    }
  });

  tool({
    name: "compare_programmes",
    description: "Fetch the side-by-side comparison note(s) between CS programmes (e.g. CS vs Data Science vs Cybersecurity) and return their short answers + summary. Use for 'which programme is different / which should I choose' questions.",
    parameters: { type: "object", properties: { names: strArrParam("Optional programme names to compare, e.g. ['Computer Science','Cybersecurity']") }, required: [] },
    fn: function (a) {
      var want = normList(a.names);
      var out = [];
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var e = knowledgeIndex[i];
        // Comparison notes no longer live in a dedicated "10_compare" folder
        // (removed from the vault); they are titled "… vs …" / "…Key
        // Differences" inside 05_programmes / 04_curriculum / 02_jupas-scores.
        var isCompare = /\bvs\b|differen|compar/.test(e.title.toLowerCase());
        if (!isCompare) continue;
        var hay = e.title.toLowerCase() + " " + e.text.toLowerCase();
        if (want.length && !want.every(function (w) { return hay.indexOf(w.toLowerCase()) >= 0; })) continue;
        out.push({ id: i, slug: e.slug, title: e.title, short_answer: shortAnswer(e), summary: e.text.slice(0, 900) });
        if (out.length >= 3) break;
      }
      return { ok: true, count: out.length, comparisons: out, hint: out.length ? "read_note(id) for the full comparison." : "No dedicated comparison note matched — answer from get_programme_info results instead." };
    }
  });

  tool({
    name: "get_programme_streams",
    description: "Return the streams / specialisations / majors of a programme (e.g. the 5 streams of BSc CS: AI, Cybersecurity, Data Science, Multimedia, Software Engineering).",
    parameters: { type: "object", properties: { code: codeParam(), name: strParam("Or programme name") }, required: [] },
    fn: function (a, ctx) {
      var code = normStr(a.code), name = normStr(a.name).toLowerCase();
      var e = null;
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var n = knowledgeIndex[i];
        if (n.folder !== "05_programmes" && n.folder !== "06_courses") continue;
        var isCode = code && n.title.toUpperCase().indexOf(code.toUpperCase()) >= 0;
        var isName = name && n.title.toLowerCase().indexOf(name) >= 0;
        if ((isCode || isName) && (/stream|major|specialis/i.test(n.title) || /stream|major/i.test(n.text.slice(0, 400)))) { e = n; break; }
      }
      if (!e) {
        // fall back: search for streams in the programme's notes
        return { ok: false, error: "No dedicated streams note found. Use get_programme_info or search_notes(query='streams " + (code || name) + "')." };
      }
      return { ok: true, id: knowledgeIndex.indexOf(e), slug: e.slug, title: e.title, short_answer: shortAnswer(e), summary: e.text.slice(0, 1200) };
    }
  });

  // ------------------------------------------------------------------
  // SCORE cluster — parses the vault's per-year score notes
  // (07_cityu-scores, 02_jupas-scores) into numbers.
  // ------------------------------------------------------------------
  function scoreFromNote(entry) {
    var t = entry.text || "";
    var med = t.match(/(?:Median|median)\s*([0-9]+)\b/i);
    var lq = t.match(/(?:Lower Quartile|lower quartile)\s*([0-9]+)\b/i);
    var yr = (entry.title.match(/\b(20[12]\d)\b/) || t.match(/\b(20[12]\d)\b/));
    var formula = t.match(/(?:formula|Formula)[:\s]*([^\n.]{3,60})/);
    return {
      median: med ? parseInt(med[1], 10) : null,
      lower_quartile: lq ? parseInt(lq[1], 10) : null,
      year: yr ? parseInt(yr[1], 10) : null,
      formula: formula ? formula[1].trim() : null,
      short_answer: shortAnswer(entry)
    };
  }
  function findCodeScoreNote(code, folderPrefix, year) {
    if (!knowledgeIndex) return null;
    var c = String(code || "").toUpperCase();
    var fallback = null;
    for (var i = 0; i < knowledgeIndex.length; i++) {
      var e = knowledgeIndex[i];
      if (folderPrefix && e.folder.indexOf(folderPrefix) !== 0) continue;
      if (c && e.title.toUpperCase().indexOf(c) < 0) continue;
      var s = scoreFromNote(e);
      if (s.median == null) continue;
      // Prefer a note whose TITLE carries the requested year; if the note
      // has no explicit year, fall back to text.
      var titleYear = (e.title.match(/\b(20[12]\d)\b/) || [])[1];
      var entryYear = titleYear ? parseInt(titleYear, 10) : s.year;
      if (year) {
        if (entryYear === parseInt(year, 10)) return e;
        if (!titleYear && s.year === parseInt(year, 10)) return e;
        if (!fallback) fallback = e;
      } else if (!fallback) {
        fallback = e;
      }
    }
    return fallback;
  }

  tool({
    name: "get_cityu_score",
    description: "Get CityUHK's published JUPAS admission score (median + lower quartile, weighted) for a CS programme code in a given year (default 2026). Use for 'what score do I need / what was the cut-off' questions about CityU itself.",
    parameters: { type: "object", properties: { code: codeParam(), year: yearParam() }, required: ["code"] },
    fn: function (a) {
      var e = findCodeScoreNote(a.code, "07_cityu-scores", a.year);
      if (!e) return { ok: false, error: "No CityU score note for " + a.code + (a.year ? " in " + a.year : "") + ". Try get_all_cityu_scores or search_notes." };
      var s = scoreFromNote(e);
      return { ok: true, code: String(a.code).toUpperCase(), programme: capTitle(e.title), year: s.year, median: s.median, lower_quartile: s.lower_quartile, formula: s.formula, note: s.short_answer, note_id: knowledgeIndex.indexOf(e) };
    }
  });

  tool({
    name: "get_rival_score",
    description: "NO LONGER POPULATED. Cross-university score comparisons (HKU, CUHK, HKUST, …) were removed from the vault, so this returns a 'removed' notice instead of data. For CityU's own published CS scores use get_cityu_score / get_all_cityu_scores / score_history.",
    parameters: { type: "object", properties: { code: strParam("The rival university's programme code, e.g. '6004' (HKU)"), university: strParam("e.g. 'HKU', 'CUHK', 'HKUST'"), year: yearParam() }, required: [] },
    fn: function (a) {
      return {
        ok: false,
        removed: true,
        error: "Cross-university score comparisons are no longer on this site — the vault covers CityU's OWN published CS scores only. Use get_cityu_score / get_all_cityu_scores / score_history for CityU. You may add the general caution that admission score scales differ across universities and are not directly comparable."
      };
    }
  });

  tool({
    name: "get_all_cityu_scores",
    description: "List CityU's published scores for every CS programme code, optionally for one year. Use for 'list all CS admission scores' or to compare CityU programmes against each other.",
    parameters: { type: "object", properties: { year: yearParam(), limit: limitParam() }, required: [] },
    fn: function (a) {
      var lim = Math.max(1, Math.min(parseInt(a.limit, 10) || 20, 40));
      var seen = {}, out = [];
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var e = knowledgeIndex[i];
        if (e.folder !== "07_cityu-scores") continue;
        var s = scoreFromNote(e);
        if (s.median == null) continue;
        if (a.year && s.year !== parseInt(a.year, 10)) continue;
        var m = e.title.match(/(JS\d{4})/);
        if (!m) continue;
        var key = m[1] + "|" + s.year;
        if (seen[key]) continue;
        seen[key] = true;
        out.push({ code: m[1], programme: capTitle(e.title), year: s.year, median: s.median, lower_quartile: s.lower_quartile, note_id: i });
        if (out.length >= lim) break;
      }
      out.sort(function (x, y) { return x.code < y.code ? -1 : 1; });
      return { ok: true, count: out.length, scores: out };
    }
  });

  tool({
    name: "score_history",
    description: "Get the year-by-year history of CityU's published scores for one programme code (e.g. JS1204 across 2023-2026). Use for 'how has the score trended / is it rising or falling'.",
    parameters: { type: "object", properties: { code: codeParam() }, required: ["code"] },
    fn: function (a) {
      var c = String(a.code || "").toUpperCase();
      if (!c) return { ok: false, error: "code is required" };
      var byYear = {};
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var e = knowledgeIndex[i];
        if (e.folder !== "07_cityu-scores" && e.folder !== "02_jupas-scores") continue;
        if (e.title.toUpperCase().indexOf(c) < 0) continue;
        var s = scoreFromNote(e);
        if (s.year && s.median != null) byYear[s.year] = { year: s.year, median: s.median, lower_quartile: s.lower_quartile };
      }
      var years = Object.keys(byYear).map(Number).sort();
      if (!years.length) return { ok: false, error: "No score history found for " + c + ". Use get_cityu_score for a single year." };
      var hist = years.map(function (y) { return byYear[y]; });
      var first = hist[0].median, last = hist[hist.length - 1].median;
      var trend = last > first ? "rising" : (last < first ? "falling" : "flat");
      return { ok: true, code: c, history: hist, trend: trend, from: first, to: last };
    }
  });

  tool({
    name: "lookup_grade_score",
    description: "Convert HKDSE grades into the weighted JUPAS admission score the site uses (Best-5 formula), and say how it compares to CityU CS's current median/quartile. Use when the user gives actual grades, e.g. '4,4,3,3,2 — is that enough for CS?'.",
    parameters: { type: "object", properties: { grades: strParam("Up to 5 DSE grades, e.g. '5,4,4,3,3' or 'A,B,B,C,C'"), code: codeParam() }, required: ["grades"] },
    fn: function (a) {
      var g = normStr(a.grades).toUpperCase();
      var map = { "A**": 7, "A*": 6, A: 5, B: 4, C: 3, D: 2, E: 1 };
      var nums = [];
      g.split(/[,;\s]+/).filter(Boolean).forEach(function (x) {
        x = x.trim();
        if (/^\d+$/.test(x)) nums.push(parseInt(x, 10));
        else if (map[x] != null) nums.push(map[x]);
      });
      if (!nums.length) return { ok: false, error: "Could not parse grades. Pass up to 5 DSE grades, e.g. '5,4,4,3,3'." };
      nums = nums.slice(0, 5);
      nums.sort(function (x, y) { return y - x; });
      var best5 = nums;
      var total = best5.reduce(function (s, n) { return s + n; }, 0);
      var total15 = Math.round(total * 1.5);
      var code = String(a.code || "JS1204").toUpperCase();
      var cs = findCodeScoreNote(code, "07_cityu-scores", 2026) || findCodeScoreNote("JS1204", "07_cityu-scores", 2026);
      var csScore = cs ? scoreFromNote(cs) : null;
      var vs = null;
      if (csScore && csScore.median != null) {
        vs = total >= csScore.median ? "at/above the 2026 median (" + csScore.median + ")"
          : (csScore.lower_quartile != null && total >= csScore.lower_quartile ? "between the lower quartile (" + csScore.lower_quartile + ") and median (" + csScore.median + ")"
          : "below the 2026 lower quartile (" + csScore.lower_quartile + ")");
      }
      return {
        ok: true, grades_best5: best5, score: total, score_1_5x_range: total15 !== total ? total + "-" + total15 : total,
        compared_to: vs,
        caveat: "Weight-1 published formula; the 1.5x subject-weighting policy (if applied) raises the top weighted subjects. Reference only, not a cut-off."
      };
    }
  });

  // ------------------------------------------------------------------
  // PRACTICAL cluster — fees, dates, requirements, routes, logistics.
  // Each tool reads the specific note(s) that hold that fact and returns
  // the short answer + relevant slice, so answers are concrete.
  // ------------------------------------------------------------------
  function topicNotes(keyword, folders, max) {
    var out = [];
    var kw = String(keyword || "").toLowerCase();
    var fl = folders || [];
    for (var i = 0; i < (knowledgeIndex || []).length; i++) {
      var e = knowledgeIndex[i];
      if (fl.length && !fl.some(function (f) { return e.folder.indexOf(f) === 0; })) continue;
      if (kw && (e.title + " " + e.text).toLowerCase().indexOf(kw) < 0) continue;
      out.push(e);
      if (out.length >= (max || 3)) break;
    }
    return out;
  }
  function topicResult(keyword, folders, max) {
    var notes = topicNotes(keyword, folders, max);
    if (!notes.length) return { ok: false, error: "No note found about '" + keyword + "'. Try search_notes." };
    return {
      ok: true,
      count: notes.length,
      notes: notes.map(function (e) {
        return { id: knowledgeIndex.indexOf(e), slug: e.slug, title: e.title, short_answer: shortAnswer(e), summary: e.text.slice(0, 900) };
      })
    };
  }

  tool({
    name: "get_tuition_fees",
    description: "Get CityUHK undergraduate tuition fees (local vs non-local, per year, per programme where noted) and whether CS programmes differ. Use for 'how much does it cost / tuition / fees'.",
    parameters: { type: "object", properties: { programme: strParam("Optional: a specific programme to check for fee differences, e.g. 'double degree'") }, required: [] },
    fn: function (a) {
      var notes = topicNotes(a.programme || "tuition fee", ["05_programmes", "01_jupas-basics"], 3);
      if (!notes.length) notes = topicNotes("fee", null, 3);
      if (!notes.length) return { ok: false, error: "No fee note found. Try search_notes(query='tuition fee')." };
      return { ok: true, count: notes.length, notes: notes.map(function (e) { return { id: knowledgeIndex.indexOf(e), slug: e.slug, title: e.title, short_answer: shortAnswer(e), summary: e.text.slice(0, 1000) }; }) };
    }
  });

  tool({
    name: "get_jupas_key_dates",
    description: "Get the JUPAS application key dates (submit, OEA, school reference, HKDSE results, Main Round offer, acceptance-fee window) for a cycle year. Use for 'when do I apply / what are the deadlines / when are results'.",
    parameters: { type: "object", properties: { year: yearParam() }, required: [] },
    fn: function (a) {
      var e = null;
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var n = knowledgeIndex[i];
        if (n.folder !== "01_jupas-basics" && n.folder !== "03_nonjupas") continue;
        if (!/key dates/i.test(n.title)) continue;
        if (a.year && new RegExp("\\b" + a.year + "\\b").test(n.title + n.text)) { e = n; break; }
        if (!e) e = n;
      }
      if (!e) return { ok: false, error: "No key-dates note found. Try search_notes(query='JUPAS key dates')." };
      return { ok: true, id: knowledgeIndex.indexOf(e), slug: e.slug, title: e.title, text: e.text.slice(0, 1800), more: "Full table via read_note(id)." };
    }
  });

  tool({
    name: "get_entry_requirements",
    description: "Get the minimum entrance / admission requirements (DSE subjects, grades, English, additional qualifications) for a CS programme. Use for 'what grades / what subjects do I need to qualify'.",
    parameters: { type: "object", properties: { code: codeParam(), name: strParam("Or programme name") }, required: [] },
    fn: function (a) {
      var code = normStr(a.code).toUpperCase(), name = normStr(a.name).toLowerCase();
      var e = null;
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var n = knowledgeIndex[i];
        var isReq = /requirement|entry/i.test(n.title);
        if (!isReq) continue;
        if (code && n.title.toUpperCase().indexOf(code) >= 0) { e = n; break; }
        if (name && n.title.toLowerCase().indexOf(name) >= 0) { e = n; break; }
      }
      if (!e) e = (topicNotes("minimum entrance requirement", ["01_jupas-basics", "05_programmes", "03_nonjupas"], 1))[0] || null;
      if (!e) return { ok: false, error: "No requirements note found. Try search_notes(query='minimum entrance requirements')." };
      return { ok: true, id: knowledgeIndex.indexOf(e), slug: e.slug, title: e.title, short_answer: shortAnswer(e), summary: e.text.slice(0, 1100) };
    }
  });

  tool({
    name: "get_programme_duration",
    description: "Get the duration of a programme (e.g. 4 years for the standard JUPAS CS degree; note any differences for double degree / advanced standing). Use for 'how long is the degree'.",
    parameters: { type: "object", properties: { code: codeParam(), name: strParam("Or programme name") }, required: [] },
    fn: function (a) {
      var code = normStr(a.code).toUpperCase(), name = normStr(a.name).toLowerCase();
      var e = null;
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var n = knowledgeIndex[i];
        if (!/duration/i.test(n.title) && !/duration|year/i.test(n.text.slice(0, 300))) continue;
        if (code && n.title.toUpperCase().indexOf(code) >= 0) { e = n; break; }
        if (name && n.title.toLowerCase().indexOf(name) >= 0) { e = n; break; }
      }
      if (!e) e = (topicNotes("duration", ["05_programmes", "03_nonjupas"], 1))[0] || null;
      if (!e) return { ok: false, error: "No duration note found. Try search_notes(query='programme duration years')." };
      return { ok: true, id: knowledgeIndex.indexOf(e), slug: e.slug, title: e.title, short_answer: shortAnswer(e), summary: e.text.slice(0, 900) };
    }
  });

  tool({
    name: "get_application_routes",
    description: "Explain the ways to get into CityUHK CS: JUPAS, non-JUPAS (local), advanced standing / transfer, and international (non-local) routes, with their codes and fees. Use for 'how do I apply / what are my options to apply'.",
    parameters: { type: "object", properties: {}, required: [] },
    fn: function (a, ctx) {
      var out = {};
      out.jupas = (topicNotes("JUPAS", ["01_jupas-basics"], 1))[0];
      out.nonjupas = (topicNotes("non-JUPAS", ["03_nonjupas"], 1))[0];
      var intl = (topicNotes("non-local", null, 1))[0] || (topicNotes("international", null, 1))[0];
      out.international = intl;
      var found = out.jupas || out.nonjupas || out.international;
      if (!found) return { ok: false, error: "No route notes found. Try search_notes(query='how to apply')." };
      function pack(e) { return e ? { id: knowledgeIndex.indexOf(e), slug: e.slug, title: e.title, short_answer: shortAnswer(e) } : null; }
      return { ok: true, jupas: pack(out.jupas), non_jupas: pack(out.nonjupas), international: pack(out.international), hint: "read_note(id) for details on any route." };
    }
  });

  tool({
    name: "get_scholarships",
    description: "Get scholarships / financial aid available to CityUHK CS students (amounts, eligibility, thresholds). Use for 'scholarships / funding / bursaries / financial aid'. Optionally set type to 'jupas', 'international', 'mainland', 'athlete', or 'donor' to narrow; omit for the main local entrance scholarships.",
    parameters: { type: "object", properties: { type: strParam("Optional: 'jupas' (local JUPAS Flagship/Institutional/Dean's), 'international', 'mainland', 'athlete', or 'donor'") }, required: [] },
    fn: function (a) {
      var t = normStr(a.type).toLowerCase();
      var queries = {
        jupas: ["scholarship jupas", "scholarship", "bursary"],
        international: ["scholarship international", "scholarship non-local", "scholarship"],
        mainland: ["scholarship mainland", "scholarship"],
        athlete: ["athletes entrance scholarship", "scholarship"],
        donor: ["donor scholarships", "scholarship"]
      };
      var qs = queries[t] || ["scholarship", "bursary", "financial aid"];
      var seen = {}, results = [];
      for (var qi = 0; qi < qs.length && results.length < 6; qi++) {
        var r = searchCore(qs[qi], 6);
        for (var i = 0; i < r.count && results.length < 6; i++) {
          var res = r.results[i];
          if (seen[res.id]) continue;
          seen[res.id] = true;
          results.push(res);
        }
        if (results.length) break; // only fall back to next query if the first returned nothing
      }
      if (!results.length) return { ok: false, error: "No scholarship note found in the FAQ. Try search_notes(query='scholarship')." };
      return { ok: true, count: results.length, notes: results.map(function (s) { return { id: s.id, slug: s.slug, title: s.title, short_answer: s.short_answer, snippet: s.snippet }; }) , hint: "For full requirement tables (minimum HKDSE scores, A*/IB thresholds, HK$ amounts) call read_note(id) on the relevant note." };
    }
  });

  tool({
    name: "get_rankings",
    description: "Get CityUHK CS academic rankings / reputation (QS, THE, subject world rankings, local standing). Use for 'how is CityU CS ranked / is it good / reputation'.",
    parameters: { type: "object", properties: {}, required: [] },
    fn: function (a) {
      var notes = topicNotes("ranking", ["00_vault-map", "05_programmes"], 3);
      if (!notes.length) notes = topicNotes("ranked", null, 3);
      if (!notes.length) return { ok: false, error: "No ranking note found. Try search_notes(query='QS ranking')." };
      return { ok: true, count: notes.length, notes: notes.map(function (e) { return { id: knowledgeIndex.indexOf(e), slug: e.slug, title: e.title, short_answer: shortAnswer(e), summary: e.text.slice(0, 900) }; }) };
    }
  });

  // ------------------------------------------------------------------
  // COURSE & CURRICULUM cluster — the 91 course FAQs (06_courses) and
  // curriculum notes (04_curriculum).
  // ------------------------------------------------------------------
  function courseCodeOf(title) {
    var m = String(title || "").match(/\b((?:CS|IT|IF|CPE|EE|AMath|MATH|PHYS|CHEM|BIOL|STAT|BIOI|ME|IE|AC|BA|BF|ECON|MGMT|ACCT)[0-9]{3,4}[A-Z]?)\b/i);
    return m ? m[1].toUpperCase() : null;
  }
  function findCourse(code, name) {
    code = String(code || "").toUpperCase().replace(/\s+/g, "");
    name = String(name || "").toLowerCase();
    for (var i = 0; i < (knowledgeIndex || []).length; i++) {
      var e = knowledgeIndex[i];
      if (e.folder !== "06_courses") continue;
      var cc = courseCodeOf(e.title);
      if (code && cc && (cc === code || e.title.toUpperCase().indexOf(code) >= 0)) return e;
      if (name && e.title.toLowerCase().indexOf(name) >= 0) return e;
    }
    return null;
  }

  tool({
    name: "get_course_info",
    description: "Get one CS course's FAQ: what it is, which year/area it belongs to, prerequisites, and workload hints. Use when the user names a course code (e.g. CS1102, CS2505) or title.",
    parameters: { type: "object", properties: { code: strParam("Course code, e.g. CS1102"), name: strParam("Or the course title, e.g. 'Algorithms'") }, required: [] },
    fn: function (a) {
      var e = findCourse(a.code, a.name);
      if (!e) return { ok: false, error: "No course found for '" + (a.code || a.name) + "'. Use list_courses to browse, or search_notes." };
      return { ok: true, id: knowledgeIndex.indexOf(e), slug: e.slug, title: e.title, short_answer: shortAnswer(e), summary: e.text.slice(0, 1100), more: "read_note(id) for the full course FAQ." };
    }
  });

  tool({
    name: "list_courses",
    description: "List CS course codes + titles, optionally filtered by year (1-4), area, or a keyword. Use for 'what courses are in year 2 / list the core courses / what's in the AI stream'.",
    parameters: {
      type: "object",
      properties: {
        year: intParam("Optional year level 1-4"),
        keyword: strParam("Optional: filter titles containing this, e.g. 'algorithms'"),
        limit: limitParam()
      },
      required: []
    },
    fn: function (a) {
      var year = parseInt(a.year, 10), kw = normStr(a.keyword).toLowerCase();
      var lim = Math.max(1, Math.min(parseInt(a.limit, 10) || 20, 40));
      var out = [];
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var e = knowledgeIndex[i];
        if (e.folder !== "06_courses") continue;
        if (kw && e.title.toLowerCase().indexOf(kw) < 0) continue;
        var cc = courseCodeOf(e.title);
        if (year) {
          // course-code second digit often signals year in CS dept (CS1xxx=yr1 etc.)
          var m = cc && cc.match(/^CS([0-9])/);
          if (m && year && parseInt(m[1], 10) !== year) {
            // also accept explicit "Year N" in text
            if (!new RegExp("year\\s+" + year, "i").test(e.text.slice(0, 400))) continue;
          }
        }
        out.push({ id: i, code: cc, title: e.title });
        if (out.length >= lim) break;
      }
      return { ok: true, count: out.length, courses: out, hint: "get_course_info(code) for details." };
    }
  });

  tool({
    name: "get_curriculum_overview",
    description: "Get the CS curriculum structure: core vs electives, the 5 streams, credit breakdown, and how courses fit together. Use for 'how is the CS curriculum structured / what do I study'.",
    parameters: { type: "object", properties: { limit: limitParam() }, required: [] },
    fn: function (a) {
      var out = [];
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var e = knowledgeIndex[i];
        if (e.folder !== "04_curriculum") continue;
        out.push({ id: i, slug: e.slug, title: e.title, short_answer: shortAnswer(e) });
        if (out.length >= (parseInt(a.limit, 10) || 8)) break;
      }
      if (!out.length) return { ok: false, error: "No curriculum notes found. Try search_notes(query='curriculum')." };
      return { ok: true, count: out.length, notes: out };
    }
  });

  tool({
    name: "get_core_courses",
    description: "List the common-core / foundational CS courses (programming, algorithms, data structures, systems) that all CS streams share. Use for 'what core courses are mandatory'.",
    parameters: { type: "object", properties: { limit: limitParam() }, required: [] },
    fn: function (a) {
      var out = [];
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var e = knowledgeIndex[i];
        if (e.folder !== "06_courses") continue;
        if (/core|foundational/i.test(e.text.slice(0, 400)) && /\bCS1\d{2,3}\b/.test(e.title)) {
          out.push({ id: i, code: courseCodeOf(e.title), title: e.title });
          if (out.length >= (parseInt(a.limit, 10) || 12)) break;
        }
      }
      if (!out.length) return { ok: false, error: "No core-course notes matched. Use list_courses or search_notes(query='core courses')." };
      return { ok: true, count: out.length, courses: out };
    }
  });

  tool({
    name: "list_stream_courses",
    description: "List the courses that belong to a specific CS stream (Artificial Intelligence, Cybersecurity, Data Science, Multimedia Computing, Software Engineering). Use for 'what courses are in the AI stream'.",
    parameters: { type: "object", properties: { stream: strParam("Stream name, e.g. 'Artificial Intelligence' or 'AI'") }, required: ["stream"] },
    fn: function (a) {
      var s = normStr(a.stream).toLowerCase();
      var out = [];
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var e = knowledgeIndex[i];
        if (e.folder !== "06_courses") continue;
        if ((e.text.slice(0, 600) + " " + e.title).toLowerCase().indexOf(s) >= 0) {
          out.push({ id: i, code: courseCodeOf(e.title), title: e.title });
          if (out.length >= 25) break;
        }
      }
      if (!out.length) return { ok: false, error: "No courses matched stream '" + a.stream + "'. Use get_programme_streams to list the streams, then search_notes." };
      return { ok: true, count: out.length, stream: a.stream, courses: out };
    }
  });

  tool({
    name: "get_course_prerequisites",
    description: "Get the prerequisites / co-requisites and recommended background for a specific course. Use for 'what do I need before CS2505 / what are the prerequisites'.",
    parameters: { type: "object", properties: { code: strParam("Course code, e.g. CS2505"), name: strParam("Or course title") }, required: [] },
    fn: function (a) {
      var e = findCourse(a.code, a.name);
      if (!e) return { ok: false, error: "No course found for '" + (a.code || a.name) + "'. Use get_course_info or list_courses first." };
      var text = e.text;
      var m = text.match(/(prerequisit[\s\S]{0,300}?)(\n##|\n###|$)/i);
      var snippet = m ? m[1].trim() : text.slice(0, 600);
      return { ok: true, id: knowledgeIndex.indexOf(e), code: courseCodeOf(e.title), title: e.title, prerequisites: snippet.slice(0, 500), more: "read_note(id) for the full course FAQ." };
    }
  });

  tool({
    name: "get_elective_list",
    description: "List CS elective courses (non-core), optionally by stream or keyword. Use for 'what electives can I take / list electives'.",
    parameters: { type: "object", properties: { keyword: strParam("Optional filter, e.g. 'web' or 'graphics'"), limit: limitParam() }, required: [] },
    fn: function (a) {
      var kw = normStr(a.keyword).toLowerCase();
      var out = [];
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var e = knowledgeIndex[i];
        if (e.folder !== "06_courses") continue;
        if (/elective/i.test(e.text.slice(0, 600))) {
          if (kw && e.title.toLowerCase().indexOf(kw) < 0) continue;
          out.push({ id: i, code: courseCodeOf(e.title), title: e.title });
          if (out.length >= (parseInt(a.limit, 10) || 20)) break;
        }
      }
      if (!out.length) return { ok: false, error: "No electives matched. Use list_courses to browse, or search_notes(query='elective')." };
      return { ok: true, count: out.length, courses: out };
    }
  });

  // ------------------------------------------------------------------
  // TOPIC cluster — one tool per common question intent. Each reads the
  // note(s) that actually hold that answer and returns them, so the model
  // can answer concretely instead of re-searching.
  // ------------------------------------------------------------------
  tool({ name: "get_employment_outcomes", description: "Get CS graduate employment statistics (salaries, destinations, top employers) for a programme. Use for 'what do graduates do / starting salary / job prospects'.", parameters: { type: "object", properties: { code: codeParam(), name: strParam("Or programme name") }, required: [] }, fn: function (a) { var e = findTopic("employment", a); return e ? packNote(e, 1000) : { ok: false, error: "No employment note found. Try search_notes(query='employment outcomes')." }; } });
  tool({ name: "get_research_areas", description: "Get the CS department's research areas / labs / focus topics. Use for 'what is CS research at CityU / research groups'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("research", ["05_programmes", "00_vault-map"], 3); return packNotes(n, "research note"); } });
  tool({ name: "get_1_5x_weighting", description: "Explain the JUPAS 1.5x subject-weighting policy: what it does, which subjects count, its current status, and how it changes a candidate's admission score. Use for 'what is 1.5x weighting / how does weighting work'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("1.5x", ["01_jupas-basics"], 2); if (!n.length) n = topicNotes("subject weighting", ["01_jupas-basics"], 2); return packNotes(n, "1.5x weighting note"); } });
  tool({ name: "get_double_degree_info", description: "Get details of the CS double degree (BSc CS + BSc Computational Finance & FinTech, JS1221): how it works, duration, fees, entry. Use for questions about the double degree / JS1221.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("double degree", ["05_programmes", "01_jupas-basics", "02_jupas-scores"], 2); return packNotes(n, "double degree note"); } });
  tool({ name: "get_admission_process", description: "Explain how JUPAS admission works end-to-end: applications, choices, Main Round, Supplementary Round, and how offers are made. Use for 'how does JUPAS work / how are offers decided'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("JUPAS", ["01_jupas-basics"], 2); return packNotes(n, "JUPAS process note"); } });
  tool({ name: "get_flexible_admission", description: "Explain flexible admission: when CityU may make an offer even if the published score/quartile is not met (boundary cases, OEA, holistic review). Use for 'I'm just below the cut-off, any chance / what is flexible admission'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("flexible admission", null, 2); return packNotes(n, "flexible admission note"); } });
  tool({ name: "get_international_admission", description: "Get how international / non-local students apply to CityUHK CS (non-JUPAS international route, documents, fees, quotas). Use for 'I'm an international student, how do I apply / can foreigners apply'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("non-local", ["03_nonjupas", "01_jupas-basics"], 2); if (!n.length) n = topicNotes("international", null, 2); return packNotes(n, "international admission note"); } });
  tool({ name: "get_advancement_transfer", description: "Get advanced standing / transfer / articulation routes into CityUHK CS (starting in year 2, credit transfer, associate-degree pathways). Use for 'can I start in year 2 / transfer into CS / advanced standing'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("advanced standing", ["03_nonjupas"], 2); if (!n.length) n = topicNotes("transfer", null, 2); return packNotes(n, "advanced standing/transfer note"); } });
  tool({ name: "get_placement_career", description: "Get internship, industry placement, and career-services info for CS students. Use for 'is there an internship / placement programme / career support'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("placement", null, 2); if (!n.length) n = topicNotes("internship", null, 2); return packNotes(n, "placement/internship note"); } });
  tool({ name: "get_campus_location", description: "Get the CityUHK Kowloon Tong campus location, how to get there, and facilities relevant to CS students. Use for 'where is the campus / how do I get to CityU'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("campus", null, 2); if (!n.length) n = topicNotes("Kowloon Tong", null, 2); return packNotes(n, "campus note"); } });
  tool({ name: "get_accommodation", description: "Get on-campus student accommodation info for CityUHK CS freshmen (availability, cost, eligibility). Use for 'is there student housing / where will I stay / accommodation'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("accommodation", null, 2); if (!n.length) n = topicNotes("dormitory", null, 2); return packNotes(n, "accommodation note"); } });
  tool({ name: "get_finance_loan", description: "Get student finance options: HKSF / JUPAS loan, tuition payment instalments, and cost planning. Use for 'student loan / how do I pay tuition / financial assistance'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("loan", null, 2); if (!n.length) n = topicNotes("HKSF", null, 2); return packNotes(n, "finance/loan note"); } });
  tool({ name: "get_language_requirement", description: "Get the English / DSE language subject requirement for CS admission (and any other subject minimums). Use for 'what English grade do I need / language requirement'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("English", ["01_jupas-basics", "05_programmes"], 2); if (!n.length) n = topicNotes("language requirement", null, 2); return packNotes(n, "language requirement note"); } });
  tool({ name: "get_subject_weights", description: "Get how JUPAS weights the best-5 subjects for CityU CS (which subjects count, best-5 rule, bonus/penalty). Use for 'how is the admission score calculated / subject weighting for CityU CS'.", parameters: { type: "object", properties: { code: codeParam() }, required: [] }, fn: function (a) { var e = findCodeScoreNote(a.code, "07_cityu-scores"); if (e) { var s = scoreFromNote(e); return { ok: true, code: String(a.code).toUpperCase(), formula: s.formula, note: s.short_answer, note_id: knowledgeIndex.indexOf(e) }; } var n = topicNotes("weighting formula", ["01_jupas-basics", "02_jupas-scores"], 2); return packNotes(n, "weighting formula note"); } });
  tool({ name: "get_oae_info", description: "Get the OAE (Other Academic Exercises) / additional exercises for CS admission if any. Use for 'is there an interview / OAE / additional exercise for CS'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("OAE", ["01_jupas-basics", "05_programmes"], 2); if (!n.length) n = topicNotes("additional exercise", null, 2); return packNotes(n, "OAE note"); } });
  tool({ name: "get_application_fee", description: "Get the non-JUPAS / direct-application fee (e.g. HK$200 per programme) and whether JUPAS charges an application fee. Use for 'how much does it cost to apply / application fee'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("application fee", ["03_nonjupas", "01_jupas-basics"], 2); if (!n.length) n = topicNotes("HK$200", null, 2); return packNotes(n, "application fee note"); } });
  tool({ name: "get_jupas_choices", description: "Explain JUPAS choices: how many choices you can enter, how to order them, and how to update them before/after results. Use for 'how many choices can I put / how do I fill in my JUPAS choices'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("choices", ["01_jupas-basics"], 2); if (!n.length) n = topicNotes("update choices", null, 2); return packNotes(n, "JUPAS choices note"); } });
  tool({ name: "get_admission_rounds", description: "Explain the JUPAS rounds: Main Round vs Supplementary Round, when each offers, and what happens if you miss Main Round. Use for 'what is the Main Round / Supplementary Round / if I don't get in Main Round'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("Main Round", ["01_jupas-basics", "02_jupas-scores"], 2); if (!n.length) n = topicNotes("Supplementary Round", null, 2); return packNotes(n, "admission rounds note"); } });
  tool({ name: "get_hkdse_best5", description: "Explain the 'Best 5 subjects' rule for CityU CS's JUPAS score: which 5 count, how DSE grades map to points, and the weighting. Use for 'how are my 5 subjects chosen / best 5 rule'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var e = findCodeScoreNote("JS1204", "07_cityu-scores"); if (e) { var s = scoreFromNote(e); return { ok: true, formula: s.formula, note: s.short_answer, note_id: knowledgeIndex.indexOf(e) }; } var n = topicNotes("Best 5", ["01_jupas-basics", "02_jupas-scores"], 2); return packNotes(n, "best-5 rule note"); } });
  tool({ name: "get_deferred_admission", description: "Explain deferring an offer / deferring entry (starting later than the offer year) and any conditions. Use for 'can I defer my offer / start a year later'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("defer", null, 2); if (!n.length) n = topicNotes("deferred", null, 2); return packNotes(n, "deferral note"); } });
  tool({ name: "get_graduation_requirements", description: "Get the graduation requirements for the CS degree (total credits, core + elective split, any requirements per stream). Use for 'how many credits to graduate / what do I need to complete the degree'.", parameters: { type: "object", properties: { code: codeParam() }, required: [] }, fn: function (a) { var n = topicNotes("graduation", ["04_curriculum", "05_programmes"], 2); if (!n.length) n = topicNotes("credits", ["04_curriculum"], 2); return packNotes(n, "graduation requirement note"); } });
  tool({ name: "get_course_units", description: "Get the credit units / workload for a specific CS course. Use for 'how many credits is CS2505 / what's the workload'.", parameters: { type: "object", properties: { code: strParam("Course code, e.g. CS2505"), name: strParam("Or course title") }, required: [] }, fn: function (a) { var e = findCourse(a.code, a.name); if (!e) return { ok: false, error: "No course found. Use get_course_info or list_courses first." }; var m = (e.text).match(/(\d)\s*(?:credits|units)/i); return { ok: true, id: knowledgeIndex.indexOf(e), code: courseCodeOf(e.title), title: e.title, units: m ? parseInt(m[1], 10) : null, short_answer: shortAnswer(e), more: "read_note(id) for the full course FAQ." }; } });
  tool({ name: "get_medium_of_instruction", description: "Get the language(s) of instruction for CityUHK CS courses (English; any bilingual options). Use for 'is it taught in English / language of instruction'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("language of instruction", null, 2); if (!n.length) n = topicNotes("bilingual", null, 2); return packNotes(n, "medium of instruction note"); } });
  tool({ name: "get_cs_department", description: "Get an overview of the CityUHK Department of Computer Science (faculty, size, facilities, college it sits in). Use for 'tell me about the CS department / college of computing'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("Department of Computer Science", ["00_vault-map", "05_programmes"], 3); if (!n.length) n = topicNotes("department", null, 3); return packNotes(n, "department note"); } });
  tool({ name: "list_all_notes", description: "List ALL note titles in the vault (paginated by limit). Use to answer 'what can this assistant tell me about / what topics exist' or to find a note when other searches fail.", parameters: { type: "object", properties: { limit: limitParam(), offset: intParam("Start position (for paging, default 0)") }, required: [] }, fn: function (a) { var lim = Math.max(1, Math.min(parseInt(a.limit, 10) || 30, 100)); var off = Math.max(0, parseInt(a.offset, 10) || 0); var out = []; for (var i = off; i < (knowledgeIndex || []).length && out.length < lim; i++) { var e = knowledgeIndex[i]; out.push({ id: i, title: e.title, folder: e.folder }); } return { ok: true, total: (knowledgeIndex || []).length, count: out.length, offset: off, notes: out }; } });
  tool({ name: "get_related_notes", description: "Get notes related to the CURRENT page (or a given topic): same programme code, folder neighbours, and shared keywords. Use for 'what else should I read / related topics to this page'.", parameters: { type: "object", properties: { topic: strParam("Optional topic/code to relate to; default = current page"), limit: limitParam() }, required: [] }, fn: function (a) { var topic = normStr(a.topic); if (!topic) { var art = (typeof document !== "undefined" && document.querySelector("article")); topic = (document.title || ""); } if (!topic) return { ok: false, error: "No topic given and no current page." }; var tl = topic.toLowerCase(); var out = []; for (var i = 0; i < (knowledgeIndex || []).length && out.length < 8; i++) { var e = knowledgeIndex[i]; if (e.title.toLowerCase() === tl) continue; var score = 0; var words = tl.split(/\s+/).filter(function (w) { return w.length > 3; }); for (var w = 0; w < words.length; w++) { if (e.title.toLowerCase().indexOf(words[w]) >= 0) score += 3; if ((e.text || "").toLowerCase().indexOf(words[w]) >= 0) score += 1; } if (score >= 2) out.push({ id: i, slug: e.slug, title: e.title, folder: e.folder, score: score }); } out.sort(function (x, y) { return y.score - x.score; }); return { ok: true, count: out.length, related: out.slice(0, parseInt(a.limit, 10) || 6) }; } });
  tool({ name: "get_contact_info", description: "Get contact details / links for the CS department or admissions office (where to email/call). Use for 'who do I contact / where do I ask / contact the department'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("contact", null, 3); if (!n.length) n = topicNotes("admissions office", null, 3); return packNotes(n, "contact note"); } });

  function findTopic(kw, a) {
    var code = normStr(a && a.code).toUpperCase(), name = normStr(a && a.name).toLowerCase();
    var list = topicNotes(kw, ["05_programmes", "00_vault-map"], 4);
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (code && e.title.toUpperCase().indexOf(code) >= 0) return e;
      if (name && e.title.toLowerCase().indexOf(name) >= 0) return e;
    }
    return list[0] || null;
  }
  function packNote(e, chars) {
    return { ok: true, id: knowledgeIndex.indexOf(e), slug: e.slug, title: e.title, short_answer: shortAnswer(e), summary: e.text.slice(0, chars || 1000), more: "read_note(id) for the full text." };
  }
  function packNotes(notes, label) {
    if (!notes || !notes.length) return { ok: false, error: "No " + label + " found. Try search_notes." };
    return { ok: true, count: notes.length, notes: notes.map(function (e) { return { id: knowledgeIndex.indexOf(e), slug: e.slug, title: e.title, short_answer: shortAnswer(e), summary: e.text.slice(0, 800) }; }) };
  }

  // ------------------------------------------------------------------
  // PYTHON cluster — Pyodide (CPython compiled to WebAssembly) so the
  // agent can compute over the FAQ data (or anything) with real Python.
  // The current knowledge index is exposed to Python as `knowledge`
  // (a list of dicts: slug, title, folder, text). Built-in packages
  // (numpy, pandas, matplotlib, scipy, sympy, ...) load via loadPackage;
  // anything else via micropip. First use downloads the runtime (~10MB)
  // once; afterwards it is cached in the browser.
  // ------------------------------------------------------------------
  var PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.27.5/full/pyodide.mjs";
  var pyodideState = { mod: null, inst: null, loading: null, ready: false, err: null };

  function pyLoadPackage(pyodide, name) {
    return pyodide.loadPackage(name).then(
      function () { return { pkg: name, ok: true, via: "built-in" }; },
      function () {
        // Not a built-in Pyodide package -> try micropip (PyPI).
        return pyodide.loadPackage("micropip").then(function () {
          return pyodide.runPythonAsync("import micropip; await micropip.install('" + String(name).replace(/'/g, "") + "')");
        }).then(function () { return { pkg: name, ok: true, via: "micropip" }; });
      }
    );
  }

  async function ensurePyodide() {
    if (pyodideState.ready) return pyodideState.inst;
    if (pyodideState.err) throw new Error(pyodideState.err);
    if (pyodideState.loading) return pyodideState.loading;
    pyodideState.loading = (async function () {
      try {
        if (!pyodideState.mod) {
          pyodideState.mod = await import(PYODIDE_URL);
        }
        var pyodide = await pyodideState.mod.loadPyodide({
          indexURL: "https://cdn.jsdelivr.net/pyodide/v0.27.5/full/"
        });
        pyodideState.inst = pyodide;
        pyodideState.ready = true;
        return pyodide;
      } catch (e) {
        pyodideState.err = "Pyodide failed to load: " + (e && e.message ? e.message : e);
        pyodideState.loading = null;
        throw new Error(pyodideState.err);
      }
    })();
    return pyodideState.loading;
  }

  tool({
    name: "run_python",
    description: "Run Python code (via Pyodide/WebAssembly, in the browser) to compute or extract anything from the FAQ data or do math. The current knowledge index is available as `knowledge` — a list of dicts with keys slug, title, folder, text. Built-in packages numpy/pandas/matplotlib/scipy/sympy are preinstalled on demand; pass `packages` to load more (e.g. 'pandas', 'qrcode'). Print your answer with print(). Use this for aggregations, comparisons, rankings, score math, or any analysis the other tools can't express. You can also GENERATE IMAGES (e.g. QR codes with the 'qrcode' package, charts with matplotlib): encode them as a base64 PNG and print `data:image/png;base64,....` — the chat renders it inline as a picture. The code must not try to use the network or filesystem.",
    parameters: {
      type: "object",
      properties: {
        code: strParam("Python code to run. `knowledge` holds the FAQ notes. End with print() of the result you want."),
        packages: strArrParam("Optional extra Python packages to install first, e.g. ['pandas']")
      },
      required: ["code"]
    },
    fn: async function (a, ctx) {
      var code = String((a && a.code) || "").trim();
      if (!code) return { ok: false, error: "code is required" };
      var pkgs = normList(a && a.packages);
      var t0 = Date.now();
      var pyodide;
      try {
        pyodide = await ensurePyodide();
      } catch (e) {
        return { ok: false, error: String(e.message || e), hint: "Pyodide needs a network fetch on first use; check connectivity and retry." };
      }
      try {
        for (var i = 0; i < pkgs.length; i++) {
          var r = await pyLoadPackage(pyodide, pkgs[i]);
          if (!r.ok) return { ok: false, error: "Failed to install package " + pkgs[i] };
        }
        // Inject the knowledge index as a REAL Python list of dicts (toPy
        // converts the JS array, so Python can subscript/iterate it normally).
        var data = (knowledgeIndex || []).map(function (e) {
          return { slug: e.slug, title: e.title, folder: e.folder, text: (e.text || "").slice(0, 1200) };
        });
        var n = (knowledgeIndex || []).length;
        var pyKnowledge = null;
        try { pyKnowledge = pyodide.toPy(data); }
        catch (e) { pyKnowledge = data; }
        pyodide.globals.set("knowledge", pyKnowledge);
        pyodide.globals.set("knowledge_count", n);
        // Capture stdout.
        var out = "";
        pyodide.setStdout({ batched: function (s) { out += s + "\n"; } });
        var ret = null;
        try {
          ret = await pyodide.runPythonAsync(code);
        } catch (pe) {
          return { ok: false, error: "Python error: " + String(pe.message || pe), stdout: out.slice(0, 4000) };
        }
        var retStr = "";
        try { retStr = (ret != null) ? String(ret) : ""; } catch (e) { retStr = ""; }
        if (retStr && !out) out = retStr;
        return {
          ok: true,
          stdout: out.slice(0, 6000),
          truncated: out.length > 6000,
          notes_available: n,
          ms: Date.now() - t0
        };
      } catch (e) {
        return { ok: false, error: "Python run failed: " + (e && e.message ? e.message : e) };
      }
    }
  });

  tool({
    name: "python_packages_available",
    description: "List the Python packages already available to run_python without extra install (Pyodide built-ins) and note that anything else can be pip-installed on demand. Use to decide whether to pass `packages` to run_python.",
    parameters: { type: "object", properties: {}, required: [] },
    fn: function () {
      return {
        ok: true,
        builtin: ["numpy", "pandas", "matplotlib", "scipy", "sympy", "Pillow", "requests", "sqlite3", "lxml"],
        note: "These are Pyodide's bundled packages (loaded on first use). Any other PyPI package can be installed at runtime by passing it in run_python's `packages` (via micropip) — e.g. ['scikit-learn', 'beautifulsoup4']. Pure-Python packages work best; some compiled ones may not have a Pyodide build."
      };
    }
  });


/* ================================================================
 AI Chat Widget — CityUHK CS Admission FAQ
 In-browser LLM (WebLLM, WebGPU) OR any OpenAI-compatible
 /chat/completions endpoint (OpenRouter, Groq, OpenAI, local
 llama.cpp/Ollama/llama-server, vLLM, ...) + keyword RAG over a
 static knowledge index + a client-side AGENT LOOP with tool calling
 (search notes, open a page, read the current page).
 In-browser mode: no data leaves the browser. External mode: your
 questions go to the endpoint you configure (key kept in this
 browser's localStorage).

 WebLLM function-calling notes (verified against the 0.2.85
 bundle source):
 - Only the Hermes-2-Pro / Hermes-3 8B/7B family is in the
   bundle's functionCallingModelIds. For those models, passing
   `tools` makes WebLLM (a) forbid any custom `system` message
   (it injects its own Hermes tool-prompt), (b) force the output
   to the Hermes function-call JSON schema, and (c) return the
   parsed calls as `delta.tool_calls` on the last streaming
   chunk (finish_reason "tool_calls").
 - Consequence: while `tools` is present the model CANNOT emit a
   plain-text answer (grammar lock). Hence the two-phase loop:
   Phase 1 (tools) selects/runs the tool, Phase 2 (no tools)
   writes the answer. External endpoints do NOT have this
   restriction, so a single request can answer with tools attached.
 - Non-Hermes small models get RAG-only answers (fast mode).
 Plain top-level script (no import/export): works both as an ES
 module (production build) and inside the IIFE-wrapped serve-mode
 bundle. Mounts into <html> (not document.body) so the SPA
 router, which morphs document.body, never destroys the widget.
 ================================================================ */
  // NOTE: this file is concatenated AFTER tools.js and wrapped in a SINGLE
  // IIFE by the plugin loader (index.js), so tools.js and this file share one
  // scope (tools.js reads knowledgeIndex/BASE defined here). Do NOT add an
  // outer function wrapper here.
  if (window.__aiChatLoaded) return;
  window.__aiChatLoaded = true;

  // This app registers NO service worker. But an earlier deployment left a
  // stale SW on the origin in some browsers, and it intercepts fetches (a
  // "no-op fetch handler") and 404s /static/knowledge-index.json. Unregister
  // any SW present so the page reclaims itself and fetches hit the network.
  (function clearStaleServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    try {
      navigator.serviceWorker
        .getRegistrations()
        .then(function (regs) {
          if (!regs.length) return;
          regs.forEach(function (r) { r.unregister(); });
          if (console && console.info) {
            console.info("[ai-chat] removed " + regs.length + " stale service worker(s) (this site uses none)");
          }
        })
        .catch(function () {});
    } catch (e) {}
  })();

  // ---- Config ----
  // Agent models: the only family WebLLM 0.2.85 supports for
  // OpenAI-style `tools` (grammar-constrained tool calling).
  var AGENT_MODELS = [
    "Hermes-3-Llama-3.1-8B-q4f16_1-MLC",
    "Hermes-3-Llama-3.1-8B-q4f32_1-MLC",
    "Hermes-2-Pro-Llama-3-8B-q4f16_1-MLC",
    "Hermes-2-Pro-Mistral-7B-q4f16_1-MLC"
  ];
  // Fast models: smaller and quicker; answer from retrieved notes
  // only (WebLLM 0.2.85 has no `tools` support for them).
  var FAST_MODELS = [
    "Hermes-3-Llama-3.2-3B-q4f16_1-MLC",
    "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    "Qwen2.5-3B-Instruct-q4f16_1-MLC",
    "Llama-3.2-1B-Instruct-q4f16_1-MLC"
  ];
  var MODELS = AGENT_MODELS.concat(FAST_MODELS);
  var DEFAULT_MODEL = AGENT_MODELS[0];
  var TOP_K = 8; // notes retrieved for grounding (was 5)
  var CITE_SHOW = 6; // how many retrieved notes are shown as links
  var HISTORY_KEEP = 6; // plain-text messages kept for fast mode
  var AGENT_HISTORY = 4; // plain-text messages kept for agent mode
  var AGENT_TURN_TRIM = 400; // trim old assistant replies in agent history
  var MAX_AGENT_TURNS = 4; // max model calls per user query (agent)
  var TOOL_RESULT_MAX = 6000; // chars of a tool result fed back to the model (searchCore self-trims to fit; see there)
  var PAGE_READ_MAX = 1200; // default chars for read_current_page
  var STORAGE_MODEL = "cityu-ai-chat-model";
  var STORAGE_ENDPOINT = "cityu-ai-chat-endpoint"; // {kind,baseUrl,key,model}
  // The page carries data-basepath from cfg.baseUrl even in local-serve mode,
  // where the site is served at the root. Only use the basepath when the
  // current URL actually lives under it (GitHub Pages); otherwise use root.
  var _bp = document.body.dataset.basepath || "";
  var BASE = _bp && location.pathname.indexOf(_bp) === 0 ? _bp : "";
  // NOTE: @mlc-ai/web-llm@0.2.85 ships lib/index.js; the
  // dist/webllm.min.js URL 404s on the CDN.
  var WEBLLM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/lib/index.js";
  var WEBLLM_URL_FALLBACK = "https://esm.run/@mlc-ai/web-llm@0.2.85";

  function isAgentModel(modelId) {
    return !!modelId && AGENT_MODELS.indexOf(modelId) >= 0;
  }

  // ---- Provider config: "inbrowser" (WebLLM/WebGPU, default) or
  // "external" (any OpenAI-compatible /chat/completions endpoint, e.g.
  // OpenRouter, Groq, local llama.cpp/Ollama/OpenAI-compatible servers).
  // The API key is stored in localStorage of THIS browser only. ----
  function endpointCfg() {
    try {
      var o = JSON.parse(localStorage.getItem(STORAGE_ENDPOINT) || "null");
      if (!o || (o.kind !== "external" && o.kind !== "inbrowser")) return null;
      return o;
    } catch (e) { return null; }
  }
  function saveEndpointCfg(o) {
    try { localStorage.setItem(STORAGE_ENDPOINT, JSON.stringify(o)); } catch (e) {}
  }
  function clearEndpointCfg() {
    try { localStorage.removeItem(STORAGE_ENDPOINT); } catch (e) {}
  }
  function isExternal() { return !!(endpointCfg() && endpointCfg().kind === "external"); }
  function providerReady() {
    return !!(engine || isExternal() || isFree());
  }
  function endpointModelName() {
    var c = endpointCfg();
    return (c && c.model) ? String(c.model).trim() : "";
  }

  // ---- "Free" site-provided provider (time-limited special event) ----
  // A first-class, no-setup provider: on page load we fetch a small JSON
  // config (public gist) so the site owner can ROTATE THE KEY or switch it
  // off instantly — no repo push, no rebuild, no Pages redeploy:
  //   {"enabled": true, "baseUrl": "https://.../v1", "key": "sk-...", "model": "..."}
  // If enabled and the key passes a live probe (/models), visitors get
  // grounded (RAG) answers for free with zero configuration. If the config
  // is missing/disabled, the key is rejected (401/403), or the server is
  // down, the "free" option simply does not exist and visitors fall back to
  // the normal "open settings and configure a model/server" flow.
  //
  // Priority: an explicitly saved choice (in-browser model or a user-entered
  // external server) always wins over the free provider.
  //
  // SECURITY NOTE: on a static site the key must reach the browser, so a
  // determined visitor with DevTools can read the Authorization header. The
  // embedded fallback key below is split + base64-encoded so it is not
  // visible by casually searching the bundle — but the real protection is a
  // SHORT-LIVED, REVOCABLE key (revoking it disables "free" site-wide
  // instantly) plus server-side spend/expiry limits on LiteLLM.
  // Rotation without a rebuild: a small PUBLIC GIST (see FREE_CONFIG_URL)
  // is the single source of truth for the free service. Its content may be
  //   (a) an OPAQUE one-line base64 string (recommended — not human-readable)
  //       that decodes to JSON:
  //         {"enabled":true,"baseUrl":"https://…/v1","key":"sk-…","model":"Socrates"}
  //   or (b) the same JSON in plain text.
  // The ENDPOINT, KEY and MODEL all come from the gist. Guard: the gist's
  // baseUrl is honoured only if it is https AND its host is in
  // FREE_TRUSTED_HOSTS (a public gist is editable by anyone — this stops it
  // from redirecting the site's traffic and key to an untrusted server).
  // A parseable gist is FINAL: enabled:false (or an untrusted endpoint)
  // switches free OFF even if the embedded key below is still valid. The
  // embedded fallback is used only when the gist is absent/unreachable.
  var FREE_CONFIG_URL = "https://gist.githubusercontent.com/ccha23/ca77b49f347a40190eda640295dd67b5/raw/CityUHK_Admission_FAQ"; // gist raw URL (stable, no revision hash); empty -> embedded fallback only
  var FREE_TRUSTED_HOSTS = ["socratic.cs.cityu.edu.hk"]; // https hosts the gist may point to
  var FREE_FALLBACK_BASE = "https://socratic.cs.cityu.edu.hk/litellm/v1";
  var FREE_FALLBACK_KEY_PARTS = ["c2stMGlEUS1E", "RzZXNjVPWDhZ", "bHhFTXlTdw=="];
  var FREE_FALLBACK_MODEL = "Socrates";
  var FREE_MAX_TOKENS = 2048; // Socrates is a reasoning model (needs room)
  var freeCfg = null; // {baseUrl, key, model} — set only after a live probe
  var freeChecking = false;
  var freeNote = ""; // short owner note, e.g. gist key fell back to built-in
  // Status-line composition state (provider + knowledge index).
  var _lastProvStatus = null;
  var knowledgeStatusMsg = "";

  function freeFallbackKey() {
    try { return atob(FREE_FALLBACK_KEY_PARTS.join("")); } catch (e) { return ""; }
  }
  // Verify the key with a cheap GET /models before advertising "free".
  async function freeProbe(base, key, model) {
    var ctl = (window.AbortController ? new AbortController() : null);
    var to = ctl ? setTimeout(function () { ctl.abort(); }, 8000) : null;
    try {
      var res = await fetch(String(base).replace(/\/+$/, "") + "/models", {
        headers: { "Authorization": "Bearer " + key },
        cache: "no-store",
        signal: ctl ? ctl.signal : undefined
      });
      if (!res.ok) return null;
      var data = await res.json();
      var id = (data && data.data && data.data.length) ? String(data.data[0].id) : model;
      var probeModel = id || model || "model";
      var out = { baseUrl: String(base).replace(/\/+$/, ""), key: String(key), model: probeModel, agent: false };
      // One cheap non-streamed call to learn whether this endpoint actually
      // honours tool calling. If it errors, we still keep the provider for
      // grounded RAG-only answers (agent=false) — never go dark for that.
      try {
        var tRes = await fetch(String(base).replace(/\/+$/, "") + "/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
          body: JSON.stringify({
            model: probeModel, max_tokens: 20,
            messages: [{ role: "user", content: "ping" }],
            tools: [{ type: "function", function: { name: "ping", description: "Ping probe.", parameters: { type: "object", properties: {}, required: [] } } }],
            tool_choice: "none"
          })
        });
        if (tRes.ok) out.agent = true;
      } catch (e2) { /* non-fatal: fall back to RAG-only */ }
      return out;
    } catch (e) { return null; }
    finally { if (to) clearTimeout(to); }
  }
  // ---- Free-provider configuration ----------------------------------------
  // The gist is the single source of truth. Its file content is EITHER:
  //   (a) a plain JSON object, or
  //   (b) an OPAQUE one-line base64 string that DECODES to that JSON.
  // Either may carry: {"enabled":true,"baseUrl":"https://…/v1","key":"sk-…","model":"Socrates"}
  // A parseable gist is FINAL: it can enable, disable, or rotate — even an
  // enabled:false beats the embedded fallback. The embedded fallback is used
  // ONLY when the gist is absent or unreachable (fetch fails).
  // TRUST GUARD: the gist's baseUrl is honoured only if it is https AND its
  // host is in FREE_TRUSTED_HOSTS (a public gist is editable by anyone — this
  // stops a tampered gist from redirecting the site's traffic and key to an
  // attacker's endpoint). An untrusted baseUrl is treated as "disabled".
  function freeTrustedBase(url) {
    var u = String(url || "").trim();
    if (!/^https:\/\//i.test(u)) return null;
    var host = "";
    try { host = new URL(u).hostname.toLowerCase(); } catch (e) { return null; }
    for (var i = 0; i < FREE_TRUSTED_HOSTS.length; i++) {
      if (host === FREE_TRUSTED_HOSTS[i]) return u.replace(/\/+$/, "");
    }
    return null;
  }
  function freeDecodeConfig(text) {
    var t = String(text || "").trim();
    if (!t) return null;
    // (a) already JSON?
    if (t.charAt(0) === "{") { try { return JSON.parse(t); } catch (e) { return null; } }
    // (b) opaque base64 -> decode -> JSON
    try {
      var b64 = t.replace(/[\s\u0000-\u001f]/g, "");
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
      var decoded = new TextDecoder("utf-8").decode(bytes); // safe UTF-8
      return JSON.parse(decoded);
    } catch (e) { return null; }
  }
  // Fetch the gist, decode it, and set freeCfg (or clear it if disabled).
  // Returns {status: "on"|"off"|"unreachable"} so callers can tell the
  // embedded fallback apart from an explicit off-switch.
  async function loadFreeGist() {
    var status = "unreachable";
    if (!FREE_CONFIG_URL) return status;
    try {
      var r = await fetch(FREE_CONFIG_URL, { cache: "no-store" });
      if (!r.ok) return status; // 404 (deleted) / rate-limited -> fall through
      var cfg = freeDecodeConfig(await r.text());
      if (!cfg) return status;
      // Parseable gist is final.
      if (cfg.enabled === false) return "off";
      if (cfg.enabled !== true) return "off";
      var key = typeof cfg.key === "string" ? cfg.key.trim() : "";
      var base = freeTrustedBase(cfg.baseUrl || FREE_FALLBACK_BASE);
      if (!key || !base) return "off";
      freeCfg = await freeProbe(base, key, cfg.model || FREE_FALLBACK_MODEL);
      if (freeCfg) { freeNote = ""; return "on"; }
      // Gist key was rejected (typo, already rotated, ...) — keep the service
      // up with the embedded key instead of going dark, and tell the owner.
      var fk = freeFallbackKey();
      if (fk && fk !== key) {
        freeCfg = await freeProbe(base, fk, cfg.model || FREE_FALLBACK_MODEL);
        if (freeCfg) {
          freeNote = " (gist key rejected — using built-in fallback key; fix the gist)";
          return "on";
        }
      }
      return "off";
    } catch (e) { return status; }
  }
  // Load free config (gist first, else embedded fallback) and set freeCfg.
  async function loadFreeConfig() {
    if (freeChecking) return;
    freeChecking = true;
    try {
      var s = await loadFreeGist();
      if (s === "unreachable" && !freeCfg) {
        // No usable gist -> try the embedded key at the trusted base.
        var key = freeFallbackKey();
        if (key) freeCfg = await freeProbe(FREE_FALLBACK_BASE, key, FREE_FALLBACK_MODEL);
      }
    } finally { freeChecking = false; }
  }
  function isFree() { return !!freeCfg; }
  function freeModelName() { return freeCfg ? (freeCfg.model || "server") : ""; }
  // Silently drop the free provider (e.g. the visitor chose their own model
  // or server). No message.
  function clearFree() { freeCfg = null; }
  // Drop the free provider because it failed at runtime (key revoked, 401/403)
  // and tell the visitor to configure their own.
  function invalidateFree(reason) {
    if (!freeCfg) return;
    freeCfg = null;
    addSystemMessage(
      "The free AI service is no longer available" + (reason ? " (" + reason + ")" : "") +
      ". Open \u2699 settings to load a model in your browser or connect your own server."
    );
  }
  // Switch to the free provider (no model download, no user input).
  function activateFree() {
    if (!freeCfg) return;
    var mode = freeCfg.agent
      ? "full agent — I search the FAQ, look up scores and fees, and compute before answering."
      : "I answer from the FAQ notes I retrieve for you.";
    setStatus("ready", "Free server ready: " + freeModelName());
    var note = freeNote ? freeNote : "";
    addSystemMessage(
      "Free AI is available now \u2014 " + mode + " No setup needed." + note
    );
  }

  // ---- State ----
  var knowledgeIndex = null;
  var engine = null;
  var engineLoading = false;
  var isGenerating = false;
  var conversationHistory = [];
  var panelOpen = false;
  var webllmLib = null;
  var currentModelId = null;

  function storageGetModel() {
    try { return localStorage.getItem(STORAGE_MODEL); } catch (e) { return null; }
  }
  function storageSetModel(m) {
    try { localStorage.setItem(STORAGE_MODEL, m); } catch (e) {}
  }
  function storageClearModel() {
    try { localStorage.removeItem(STORAGE_MODEL); } catch (e) {}
  }

  // ---- DOM helpers ----
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        var v = attrs[k];
        if (k === "className") e.className = v;
        else if (k === "textContent") e.textContent = v;
        else if (k.slice(0, 2) === "on" && typeof v === "function")
          e.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v !== null && v !== undefined && v !== false)
          e.setAttribute(k, v === true ? "" : v);
      }
    }
    (children || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ---- MathJax (lazy, tex-svg: no font files needed) ----
  // Assistant message content may contain $...$ / $$...$$ math. We typeset it
  // with MathJax v3 (loaded once, on demand). Because the model's answer may
  // arrive before MathJax has finished loading (first use), we QUEUE scopes
  // and flush them as soon as MathJax is ready (or via a fallback poll for
  // the first ~20s). Only FINAL (non-streaming) renders enqueue, so partial
  // math is never typeset.
  var mjxReady = false;
  var mjxPending = [];
  function mjxPump() {
    if (!mjxReady || !window.MathJax || !window.MathJax.typesetPromise) return;
    while (mjxPending.length) {
      var s = mjxPending.shift();
      try { window.MathJax.typesetPromise([s]).catch(function () {}); } catch (e) {}
    }
  }
  (function () {
    var cfg = {
      tex: { inlineMath: [["$", "$"]], displayMath: [["$$", "$$"]], processEscapes: true, processEnvironments: true },
      svg: { fontCache: "global" },
      options: { enableMenu: false }
    };
    if (window.MathJax) { for (var k in cfg) window.MathJax[k] = cfg[k]; }
    else { window.MathJax = cfg; }
    var s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js";
    s.async = true;
    s.onload = function () { mjxReady = true; mjxPump(); };
    document.head.appendChild(s);
    // Fallback: flush pending scopes periodically while MathJax is loading
    // (covers the case where a final answer lands before the CDN resolves).
    var tries = 0;
    var iv = setInterval(function () { tries++; mjxPump(); if (tries > 20 || mjxReady && !mjxPending.length) clearInterval(iv); }, 1000);
  })();
  function typesetIfReady(el) {
    if (!el) return;
    var scope = el.querySelector("[data-math]") || (el.hasAttribute && el.hasAttribute("data-math") ? el : null);
    if (!scope) return;
    mjxPending.push(scope);
    mjxPump(); // flush now if MathJax is ready (else the interval will)
  }

  // ---- Live QR codes (pure JS, no server) ----
  // Vendored qrcode-generator (MIT) exposes a global `qrcode` in this scope
  // (see index.js). A QR for a URL renders in ~10 ms as a small inline SVG
  // data-URL — far faster than spinning up Pyodide (10 MB runtime) or a
  // server round-trip, and it works fully offline once the page is loaded.
  var qrCache = {};
  function qrSvgDataUrl(text) {
    var cached = qrCache[text];
    if (cached) return cached;
    var qr = qrcode(0, "M"); // auto-size, medium error correction
    qr.addData(String(text));
    qr.make();
    var n = qr.getModuleCount();
    // One explicit unit square per dark module: "M c r h1 v1 h-1 z" (move to
    // the cell's top-left, then relative steps). Using a fresh M per cell is
    // unambiguous — a single continuous path with per-cell Z would close every
    // cell back to the row's first point and render as garbage.
    var d = "";
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += "M" + c + " " + r + "h1v1h-1z";
      }
    }
    // Quiet zone: QR decoders (phone cameras and jsQR alike) need a white
    // margin of >=4 modules around the code, so pad the viewBox by 4 on each
    // side and shift the code path in by 4.
    var M = 4, N = n + M * 2;
    // Intrinsic pixel size that is an EXACT multiple of the (padded) module
    // count so each module maps to whole pixels (crisp + scannable).
    var cell = Math.max(4, Math.round(180 / N));
    var size = N * cell;
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
      '" viewBox="0 0 ' + N + " " + N +
      '" shape-rendering="crispEdges"><rect width="' + N + '" height="' + N +
      '" fill="#fff"/><path transform="translate(' + M + "," + M + ')" d="' + d +
      '" fill="#111"/></svg>';
    var url = "data:image/svg+xml;utf8," + encodeURIComponent(svg);
    if (Object.keys(qrCache).length > 200) qrCache = {}; // bound the memo
    qrCache[text] = url;
    return url;
  }

  // Hover a link (citation or inline) in an assistant message -> a QR code
  // of that link's URL appears next to the cursor. One shared tooltip,
  // event-delegated on the messages box, positioned with viewport clamping.
  function attachLinkQrHover(box) {
    if (!box || box.__qrWired) return;
    box.__qrWired = true;
    var tip = el("div", { className: "ai-chat-qr-tip", id: "ai-chat-qr-tip" });
    var tipImg = el("img", { className: "ai-chat-qr-tip-img", alt: "QR code of the linked page" });
    var tipUrl = el("span", { className: "ai-chat-qr-tip-url" });
    tip.appendChild(tipImg);
    tip.appendChild(tipUrl);
    document.body.appendChild(tip);

    function show(link) {
      var href = link.getAttribute("href") || "";
      // Resolve to an absolute URL: a QR must encode something that scans to
      // the real page off-device, so relative/anchor links get the current
      // origin (or the current page URL for in-page anchors) prefixed.
      var abs;
      if (/^https?:/i.test(href)) abs = href;
      else if (href.charAt(0) === "#") abs = location.href.split("#")[0] + href;
      else abs = location.origin + (href.charAt(0) === "/" ? href : "/" + href);
      if (!/^https?:/i.test(abs)) return;
      tipImg.src = qrSvgDataUrl(abs);
      tipUrl.textContent = abs.replace(/^https?:\/\//, "").slice(0, 48);
      var r = link.getBoundingClientRect();
      var W = 168, H = 190;
      var x = r.left - W - 10; // prefer left of the cursor/link
      if (x < 8) x = r.right + 10;
      var y = r.top + r.height / 2 - H / 2;
      y = Math.max(8, Math.min(y, window.innerHeight - H - 8));
      x = Math.max(8, Math.min(x, window.innerWidth - W - 8));
      tip.style.left = x + "px";
      tip.style.top = y + "px";
      tip.style.display = "flex";
    }
    function hide() { tip.style.display = "none"; }

    box.addEventListener("mouseover", function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (a) show(a);
    });
    box.addEventListener("mouseout", function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (a && !(e.relatedTarget && a.contains(e.relatedTarget))) hide();
    });
    window.addEventListener("scroll", hide, { capture: true, passive: true });
  }

  // ---- Always-visible "share" button: QR of the CURRENT page (full URL) ----
  // The chat works on note slugs, so the model can't hand the user the
  // published URL. This button always shows a QR that scans to the current
  // page's full GitHub Pages URL. Click toggles it; "Copy link" copies the
  // URL. It re-targets on every in-app (SPA) navigation. The QR is generated
  // lazily (memoized by URL) so the initial page load is never blocked.
  var qrCard = null;
  function currentPageFullUrl() {
    // Full published URL (origin + path), no hash. Works on the hosted Pages
    // site and on the :8080 preview alike.
    return location.origin + location.pathname.replace(/\/$/, "");
  }
  // Full published URL for a note slug (used so the AI can hand out real
  // https:// links, not bare slugs). BASE already folds in the repo prefix on
  // GitHub Pages ("" on the :8080 preview), so this is correct in both.
  function pageUrlFor(slug) {
    var s = String(slug || "").replace(/^\/+/, "").replace(/\/+$/, "");
    if (!s) return "";
    return location.origin + BASE + "/" + s;
  }
  function copyText(text) {
    var done = function () {
      var st = qrCard && qrCard.querySelector(".ai-qr-card-status");
      if (!st) return;
      st.textContent = "Copied!";
      clearTimeout(st._t);
      st._t = setTimeout(function () {
        var s = qrCard && qrCard.querySelector(".ai-qr-card-status");
        if (s) s.textContent = "Scan with your phone";
      }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    } catch (e) {}
  }
  function updatePageQr() {
    if (!qrCard) return;
    var url = currentPageFullUrl();
    // No-op if nothing changed — this runs on every nav AND on a periodic
    // self-heal tick, so avoid re-assigning img.src / textContent (which would
    // flicker the QR) when the card already points at the current page.
    if (qrCard.dataset.url === url) return;
    var img = qrCard.querySelector("img");
    var cap = qrCard.querySelector(".ai-qr-card-url");
    if (img) img.src = qrSvgDataUrl(url); // memoized: ~0 ms once generated
    if (cap) cap.textContent = url;
    qrCard.dataset.url = url;
  }
  // The "share this page" QR lives in the LEFT SIDEBAR (below the explorer)
  // card (page-associated, not a floating overlay), as a normal, flowing
  // whole page body on every SPA navigation, so we re-inject the card each
  // time the sidebar element reappears. Its show/hide state is remembered.
  function buildSidebarQr() {
    // Re-injection. Quartz does unpredictable DOM surgery on an SPA nav: it
    // may REUSE the .sidebar.left node and just drop our card, or REPLACE the
    // whole sidebar (and its ancestors) with fresh nodes. A one-shot check can
    // therefore "succeed" while the card is still momentarily present, then
    // Quartz removes it a few ms later with nobody watching — which is why the
    // QR "sometimes" needs a manual refresh. Recovery is correct-by-construction
    // via three independent layers (injectOnce is idempotent, so redundancy is
    // cheap and safe):
    //   1. A persistent MutationObserver (PRIMARY). It fires on DOM mutation
    //      regardless of tab visibility — NOT throttled like timers/rAF — so
    //      the moment Quartz mutates the sidebar (adds related-links, drops the
    //      card, replaces the node) we re-inject.
    //   2. On each nav, a short poll that re-checks every frame (no early bail)
    //      — covers the beat before/after the observer fires.
    //   3. A 500ms self-heal interval as a last resort.
    // Find the right sidebar that is actually being rendered. During an SPA
    // re-render Quartz can briefly have MULTIPLE .sidebar.left nodes alive
    // (the previous page's stale node alongside the fresh one). Targeting the
    // wrong one is exactly what made the QR "disappear" — the card was re-used
    // in the stale node, then dropped when that node was torn down. So: scope
    // to the rendered #quartz-body, and when several candidates exist pick the
    // one that is actually laid out (has a layout box), preferring the newer.
    function currentSidebar() {
      var body = document.getElementById("quartz-body") || document;
      var c = body.querySelectorAll(".sidebar.left");
      if (!c.length) return null;
      if (c.length === 1) return c[0];
      for (var i = c.length - 1; i >= 0; i--)
        if (c[i].getClientRects().length) return c[i];
      return c[c.length - 1]; // nothing laid out yet — the newest render
    }
    function injectOnce() {
      var side = currentSidebar();
      if (!side) return false;
      // Trust the live DOM only: the card is fine iff it is a child of the
      // sidebar that is being rendered RIGHT NOW. A card left in a stale node
      // from the previous page does not count.
      var inSide = side.querySelectorAll("#ai-qr-card");
      if (inSide.length) {
        // Never allow stacked duplicates in the rendered sidebar.
        for (var d = inSide.length - 1; d > 0; d--) inSide[d].remove();
        qrCard = inSide[0];
        updatePageQr();
        return true;
      }
      // Not in the rendered sidebar: sweep stray copies out of any stale
      // nodes left behind by the re-render, then build a fresh card here.
      var all = document.querySelectorAll("#ai-qr-card");
      for (var s = all.length - 1; s >= 0; s--) all[s].remove();
      // (Re)build the card. The header (title + show/hide
      // toggle) is ALWAYS visible so the card can never get stuck hidden with
      // no way to bring it back; only the body collapses.
      var visible = localStorage.getItem("ai-qr-visible") !== "0";
      qrCard = el("div", { className: "ai-qr-card", id: "ai-qr-card" });
      var head = el("div", { className: "ai-qr-card-head" });
      head.appendChild(el("span", { className: "ai-qr-card-title", textContent: "Share this page" }));
      var body = el("div", { className: "ai-qr-card-body" + (visible ? "" : " hidden") });
      var showBtn = el("button", {
        className: "ai-qr-card-toggle",
        title: "Show / hide QR code",
        "aria-label": "Show or hide QR code",
        onclick: function () {
          var v = body.classList.toggle("hidden") === false; // true = now visible
          try { localStorage.setItem("ai-qr-visible", v ? "1" : "0"); } catch (e) {}
        }
      });
      showBtn.innerHTML =
        '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" ' +
        'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
      head.appendChild(showBtn);
      qrCard.appendChild(head);
      var img = el("img", { className: "ai-qr-card-img", alt: "QR code of the current page" });
      body.appendChild(img);
      body.appendChild(el("div", { className: "ai-qr-card-url" }));
      var copyBtn = el("button", {
        className: "ai-qr-card-copy",
        textContent: "Copy link",
        onclick: function () { copyText(qrCard.dataset.url || currentPageFullUrl()); }
      });
      body.appendChild(copyBtn);
      var st = el("div", { className: "ai-qr-card-status", textContent: "Scan with your phone" });
      body.appendChild(st);
      qrCard.appendChild(body);
      // Place the card in the LEFT sidebar directly below the explorer
      // (the explorer's nav root is the last component in the left column).
      var exNav = side.querySelector(".explorer");
      if (exNav && exNav.parentNode === side && exNav.nextSibling) {
        side.insertBefore(qrCard, exNav.nextSibling);
      } else if (exNav && exNav.parentNode === side) {
        side.appendChild(qrCard);
      } else {
        side.appendChild(qrCard);
      }
      updatePageQr();
      return true;
    }
    // Nav-triggered poll: re-check every frame for ~1.5s (do NOT bail early, or
    // a card Quartz removes a few ms after the nav goes un-re-injected).
    function ensureInjected() {
      var tries = 0;
      (function poll() {
        injectOnce();
        if (tries++ < 90) requestAnimationFrame(poll);
      })();
    }
    // PRIMARY: a persistent MutationObserver on the (stable) document root.
    // Quartz re-renders the page on every SPA nav — adding related links,
    // removing our card, or replacing the whole sidebar. MutationObserver
    // delivers its callback as a microtask and is NOT throttled or paused like
    // setTimeout/rAF, so it catches the re-render even when the tab is in the
    // background (where timers fire ~1/s and rAF is suspended). injectOnce()
    // is idempotent — if the card is already correctly placed it just
    // re-targets the URL and does nothing — so firing on every nav mutation is
    // cheap. A reentrancy guard stops the observer from re-triggering on the
    // mutation our own re-injection produces.
    var qrObServing = false;
    new MutationObserver(function () {
      if (qrObServing) return;
      qrObServing = true;
      try { injectOnce(); } finally { qrObServing = false; }
    }).observe(document.documentElement, { childList: true, subtree: true });
    // Last-resort self-heal (covers any case the observer/poll miss).
    setInterval(function () { injectOnce(); }, 500);
    ensureInjected();
    // Re-inject + re-target the QR on every in-app (SPA) navigation.
    document.addEventListener("nav", ensureInjected);
    window.addEventListener("popstate", ensureInjected);
  }

  // Sanitize a model-supplied image src: strip trailing quotes/punctuation the
  // model sometimes leaves inside the tag, then require a data: or http(s) URL.
  function sanitizeImageSrc(src) {
    if (!src) return null;
    var v = String(src).trim();
    v = v.replace(/[\s",;:']+$/, "");
    var m = v.match(/^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i);
    if (m) return m[0];
    if (/^https?:\/\/\S+$/i.test(v)) return v;
    m = v.match(/^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/i);
    return m ? m[0] : null;
  }

  // Minimal markdown: code fences + inline code, images, bold, italic, links,
  // bullet lists, paragraphs. Math ($...$ / $$...$$) is left for MathJax via
  // the data-math marker. Code regions are extracted FIRST and re-inserted
  // last, so link/bold/math processing never corrupts them.
  function renderMarkdown(text) {
    var source = String(text);
    var hasMath = /\$\$?/.test(source);
    var codeMap = [];
    // Extract fenced code blocks with a LINEAR scan, not a single regex. The
    // old pattern `(?:(?:.*(?:\r\n?|\n)?)*)?` had a nested unbounded
    // quantifier that catastrophically backtracked on an OPENING ``` whose
    // closing fence had not (yet) streamed in — and renderMarkdown re-runs on
    // the whole growing message every streamed chunk, so a code block being
    // generated (e.g. halting-problem pseudocode) froze the tab for seconds
    // to minutes. Line-by-line scanning is O(n) with no backtracking. An
    // unterminated fence (still streaming) is left as-is and re-extracted on
    // the next chunk once the closing ``` arrives.
    source = (function (src) {
      var lines = src.split("\n");
      var out = [];
      var i = 0;
      while (i < lines.length) {
        var open = lines[i].match(/^[ \t]*```[^\n]*$/);
        if (!open) { out.push(lines[i]); i++; continue; }
        var j = i + 1, buf = [], closed = -1;
        while (j < lines.length) {
          if (/^[ \t]*```[ \t]*$/.test(lines[j])) { closed = j; break; }
          buf.push(lines[j]);
          j++;
        }
        if (closed >= 0) {
          codeMap.push(buf.join("\n"));
          out.push("\u0001" + (codeMap.length - 1) + "a\u0001");
          i = closed + 1;
        } else {
          // Unterminated fence: keep the raw lines for now.
          out.push(lines[i]); i++;
        }
      }
      return out.join("\n");
    })(source);
    source = source.replace(/`([^`\n]+)`/g, function (m, inner) {
      codeMap.push(inner);
      return "\u0001" + (codeMap.length - 1) + "b\u0001";
    });

    function renderLine(rawLine) {
      // Extract ALL image forms BEFORE escaping, so escaping (and later
      // link/bold handling) can neither corrupt them nor cause double
      // wrapping: raw <img> tags, markdown ![](...), and bare data: URLs
      // (e.g. run_python output pasted verbatim).
      var imgs = [];
      var text = rawLine.replace(/<img\b[^>]*\/?>/gi, function (tag) {
        var srcM = tag.match(/\bsrc\s*=\s*"([^"]*)"/i) || tag.match(/\bsrc\s*=\s*'([^']*)'/i);
        var altM = tag.match(/\balt\s*=\s*"([^"]*)"/i) || tag.match(/\balt\s*=\s*'([^']*)'/i);
        imgs.push({ alt: (altM && altM[1]) || "image", src: srcM ? srcM[1] : null });
        return "\u0002" + (imgs.length - 1) + "\u0002";
      });
      text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (_, alt, url) {
        imgs.push({ alt: alt, src: url });
        return "\u0002" + (imgs.length - 1) + "\u0002";
      });
      text = text.replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{20,}/g, function (m) {
        imgs.push({ alt: "image", src: m });
        return "\u0002" + (imgs.length - 1) + "\u0002";
      });
      var out = esc(text);
      out = out.replace(/\u0002(\d+)\u0002/g, function (_, i) {
        var im = imgs[parseInt(i, 10)];
        return imageHtml(im ? im.alt : "image", im ? im.src : null);
      });
      out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      out = out.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
      out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, t, u) {
        var href;
        if (/^(https?:|mailto:|#)/i.test(u)) {
          href = u; // already absolute, mailto, or in-page anchor
        } else {
          // A site note (bare slug or /-prefixed path) -> full published URL,
          // so the link is directly scannable/copyable (no double-slash).
          var s = String(u).replace(/^\/+/, "").replace(/\/+$/, "");
          href = location.origin + BASE + "/" + s;
        }
        return '<a href="' + href + '">' + t + "</a>";
      });
      return out;
    }
    function imageHtml(alt, src) {
      var clean = sanitizeImageSrc(src);
      if (!clean) return "";
      var a = String(alt || "").replace(/["<>/]/g, " ").trim().slice(0, 140);
      return '<img class="ai-chat-image" src="' + esc(clean).replace(/"/g, "&quot;") + '" alt="' + esc(a) + '" loading="lazy" />';
    }

    // Interleave: odd segments (0-indexed even positions alternate) are plain
    // text; odd indices are extracted code regions.
    var segs = source.split(/\u0001(\d+)[ab]\u0001/);
    var html = "";
    var inList = false;
    for (var i = 0; i < segs.length; i++) {
      if (i % 2 === 1) {
        if (inList) { html += "</ul>"; inList = false; }
        html += "<pre class=\"ai-chat-code\"><code>" + esc(codeMap[parseInt(segs[i], 10)]) + "</code></pre>";
        continue;
      }
      var lines = segs[i].split("\n");
      for (var j = 0; j < lines.length; j++) {
        var line = lines[j];
        var m = line.match(/^\s*[-*] (.+)$/);
        if (m) {
          if (!inList) { html += "<ul>"; inList = true; }
          html += "<li>" + renderLine(m[1]) + "</li>";
          continue;
        }
        if (inList) { html += "</ul>"; inList = false; }
        if (line.trim() === "") continue;
        html += "<p>" + renderLine(line) + "</p>";
      }
    }
    if (inList) html += "</ul>";
    if (hasMath) html = '<span data-math="1" style="display:contents">' + html + "</span>";
    return html;
  }

  // ---- RAG keyword retrieval ----
  function retrieve(query, topK) {
    if (!knowledgeIndex || !knowledgeIndex.length) return [];
    var terms = query.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter(Boolean);
    if (!terms.length) return [];
    // Topic boost: when the query names a topic (e.g. scholarship), strongly
    // favor notes whose TITLE carries that topic word. Without this, queries
    // like "JUPAS scholarship requirement" are dominated by generic JUPAS
    // notes and the few on-topic notes (08_scholarships) fall out of the top
    // K, so the model gets no actual requirement tables and answers unsure.
    var boostedTerms = terms.filter(function (t) { return t.length >= 5; });
    var scored = [];
    for (var i = 0; i < knowledgeIndex.length; i++) {
      var entry = knowledgeIndex[i];
      var combined = (entry.title + " " + entry.text).toLowerCase();
      var titleLower = entry.title.toLowerCase();
      var score = 0;
      for (var t = 0; t < terms.length; t++) {
        var term = terms[t];
        var idx = combined.indexOf(term);
        if (idx >= 0) {
          score += titleLower.indexOf(term) >= 0 ? 10 : 1;
          score += Math.max(0, 5 - idx / 100);
        }
      }
      for (var b = 0; b < boostedTerms.length; b++) {
        if (titleLower.indexOf(boostedTerms[b]) >= 0) score *= 2;
      }
      if (score > 0) scored.push({ entry: entry, score: score });
    }
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, topK || TOP_K).map(function (s) { return s.entry; });
  }

  async function loadKnowledgeIndex() {
    // Try several candidate URLs. Normally BASE is correct, but a stale
    // service worker (left over from an earlier deployment on this origin)
    // can put the browser at a path where BASE is empty while the file lives
    // under the repo prefix — that produced a 404 on /static/knowledge-
    // index.json. Fall back to the data-basepath and the root so the index
    // loads regardless of which path the page is actually served from.
    var bp = (document.body.dataset && document.body.dataset.basepath) || "";
    // Candidates in priority order: the path the page is actually served
    // from (BASE), the data-basepath, then the root. No matter which one
    // works first wins, so a stale service worker (which can leave BASE
    // empty on the hosted site) can no longer 404 the index.
    var seen = {}, candidates = [];
    [BASE + "/static/knowledge-index.json",
     (bp ? bp : "") + "/static/knowledge-index.json",
     "/static/knowledge-index.json"
    ].forEach(function (c) { if (!seen[c]) { seen[c] = true; candidates.push(c); } });
    for (var i = 0; i < candidates.length; i++) {
      try {
        // no-store: this file is rewritten on every `make site-build` but its
        // NAME is fixed (not content-hashed), so force-cache would pin the
        // FIRST build's index in the browser forever and every later note
        // (new programmes, scholarships...) would be invisible to the tools.
        var res = await fetch(candidates[i], { cache: "no-store" });
        if (!res.ok) continue;
        var data = await res.json();
        if (data && data.length) {
          knowledgeIndex = data;
          setKnowledgeStatus("Index " + data.length + " notes");
          return;
        }
      } catch (e) { /* try next candidate */ }
    }
    knowledgeIndex = [];
    setKnowledgeStatus("Index unavailable \u2014 retrieval off");
  }

  function setStatus(state, msg) {
    _lastProvStatus = { state: state, msg: msg || "" };
    renderStatusLine();
  }
  // Display name of the ACTIVE provider: "Model (where it runs)", e.g.
  // "Socrates (Free server)", "gpt-4o (Your server)", "qwen2.5-7b (In-browser)".
  function providerDisplayName() {
    if (isFree()) return freeModelName() + " (Free server)";
    if (isExternal()) {
      var em = endpointModelName();
      return em ? em + " (Your server)" : "Your server";
    }
    if (engine && currentModelId) {
      var short = String(currentModelId).split("/").pop(); // drop the org prefix
      return short + " (In-browser)";
    }
    return "";
  }
  // The status line shows the provider name (ready) or the live message
  // (loading progress / error), with a state dot. No more "…ready:" prefix or
  // knowledge-index count — the dot conveys readiness.
  function renderStatusLine() {
    var t = document.getElementById("ai-chat-status-text");
    var d = document.getElementById("ai-chat-status-dot");
    if (!d || !_lastProvStatus) return;
    d.className = "status-dot" + (_lastProvStatus.state ? " " + _lastProvStatus.state : "");
    if (!t) return;
    var st = _lastProvStatus.state;
    if ((st === "loading" || st === "error") && _lastProvStatus.msg) {
      t.textContent = _lastProvStatus.msg; // progress / error detail
    } else {
      var name = providerDisplayName();
      t.textContent = name || _lastProvStatus.msg || "Starting\u2026";
    }
  }
  function setKnowledgeStatus(msg) {
    knowledgeStatusMsg = msg;
    renderStatusLine();
  }

  function messagesEl() { return document.getElementById("ai-chat-messages"); }

  function appendMessage(role, text, sources) {
    var box = messagesEl();
    if (!box) return null;
    var msg = el("div", { className: "ai-chat-message " + role });
    if (role === "assistant" && text) {
      msg.innerHTML = renderMarkdown(text);
      box.appendChild(msg);
      if (sources && sources.length) appendCitations(msg, sources);
      typesetIfReady(msg);
    } else {
      msg.textContent = text || "";
      box.appendChild(msg);
    }
    box.scrollTop = box.scrollHeight;
    return msg;
  }

  // citations: array of {slug,title} OR map {slug: title}
  function appendCitations(msgEl, items) {
    var entries;
    if (Array.isArray(items)) {
      entries = items.map(function (x) { return { slug: x.slug, title: x.title }; });
    } else {
      entries = Object.keys(items || {}).map(function (s) { return { slug: s, title: items[s] }; });
    }
    var seen = {}, list = [];
    for (var i = 0; i < entries.length; i++) {
      if (!entries[i].slug || seen[entries[i].slug]) continue;
      seen[entries[i].slug] = true;
      list.push(entries[i]);
    }
    if (!list.length) return;
    var src = el("div", { className: "ai-chat-sources" });
    var label = el("span", { className: "ai-chat-sources-label", textContent: "\uD83D\uDCD6 Sources" });
    src.appendChild(label);
    var ul = el("ul", { className: "ai-chat-sources-list" });
    // Show up to CITE_SHOW as clickable links; note how many more were used.
    var shown = list.slice(0, CITE_SHOW);
    for (var j = 0; j < shown.length; j++) {
      var s = shown[j];
      var href = pageUrlFor(s.slug) || (BASE + "/" + s.slug);
      var li = el("li");
      var a = el("a", { href: href, target: "_blank", rel: "noopener" });
      a.textContent = s.title || s.slug.split("/").pop();
      li.appendChild(a);
      ul.appendChild(li);
    }
    if (list.length > shown.length) {
      var more = el("li", { className: "ai-chat-sources-more" });
      more.textContent = "+ " + (list.length - shown.length) + " more note" + (list.length - shown.length === 1 ? "" : "s") + " retrieved";
      ul.appendChild(more);
    }
    src.appendChild(ul);
    msgEl.appendChild(src);
    // Hover-QR on each citation link (the shared hover-QR is event-delegated
    // on the messages box, so these anchors pick it up automatically).
  }

  function addSystemMessage(text) { appendMessage("system", text); }

  function scrollBottom() {
    var box = messagesEl();
    if (box) box.scrollTop = box.scrollHeight;
  }

  // A small pill shown in the transcript when the agent calls a tool.
  function addToolChip(name, argsObj) {
    var box = messagesEl();
    if (!box) return;
    var argStr = "";
    try {
      var parts = [];
      for (var k in argsObj) parts.push(k + "=" + JSON.stringify(argsObj[k]));
      argStr = parts.join(" ");
    } catch (e) { argStr = ""; }
    var chip = el("div", { className: "ai-chat-message tool" });
    chip.textContent = "\uD83D\uDD27 " + name + (argStr ? "(" + argStr + ")" : "");
    box.appendChild(chip);
    box.scrollTop = box.scrollHeight;
  }

  function showTyping(show) {
    var existing = document.getElementById("ai-chat-typing");
    if (show) {
      if (!existing) {
        var t = el("div", { id: "ai-chat-typing", className: "ai-chat-message assistant ai-chat-typing" });
        t.appendChild(el("span")); t.appendChild(el("span")); t.appendChild(el("span"));
        var box = messagesEl();
        if (box) { box.appendChild(t); box.scrollTop = box.scrollHeight; }
      }
    } else if (existing) {
      existing.remove();
    }
  }

  function showWelcome() {
    var box = messagesEl();
    if (!box) return;
    box.innerHTML = "";
    var w = el("div", { className: "ai-chat-welcome" });
    w.innerHTML =
      "<p><strong>\uD83C\uDF93 CityUHK CS Admission FAQ Assistant</strong></p>" +
      "<p>Ask about admission, JUPAS scores, programmes, curriculum or tuition fees.</p>" +
      "<p>I can <em>search the FAQ notes</em>, <em>open the source page</em> for you, and <em>read the page you are on</em> (with an agent model).</p>" +
      "<p>Retrieval runs <em>locally in your browser</em>. With the in-browser model nothing else leaves this machine; if you configure an OpenAI-compatible server in \u2699\uFE0F settings, the conversation is sent to that server.</p>" +
      "<p>Open \u2699\uFE0F settings to load a model or connect a server.</p>";
    box.appendChild(w);
  }

  // ---- WebLLM engine ----
  async function loadWebllmLib() {
    try {
      return await import(WEBLLM_URL);
    } catch (e) {
      return await import(WEBLLM_URL_FALLBACK);
    }
  }

  function gpuAvailable() {
    return typeof navigator !== "undefined" && !!navigator.gpu;
  }

  async function loadEngine(modelId) {
    if (engineLoading) return;
    if (!gpuAvailable()) {
      setStatus("error", "WebGPU not available in this browser");
      addSystemMessage(
        "This browser has no WebGPU, so the in-browser model cannot run. " +
        "Try Chrome or Edge 113+ (or Firefox 141+ with WebGPU enabled)."
      );
      return;
    }
    engineLoading = true;
    try {
      if (!webllmLib) webllmLib = await loadWebllmLib();
      if (typeof webllmLib.CreateMLCEngine !== "function") {
        throw new Error("WebLLM library loaded but CreateMLCEngine is missing.");
      }
      setStatus("loading", "Loading " + modelId + " (first time downloads the model, then cached)...");
      engine = await webllmLib.CreateMLCEngine(modelId, {
        initProgressCallback: function (r) {
          var pct = r.progress != null ? " " + Math.round(r.progress * 100) + "%" : "";
          setStatus("loading", (r.title || "Loading") + (r.message ? ": " + r.message : "") + pct);
        }
      });
      currentModelId = modelId;
      var agent = isAgentModel(modelId);
      setStatus("ready", "Ready"); // header shows "model (In-browser)"; the mode note is in the system message
      addSystemMessage(
        agent
          ? "Model loaded — I can search the FAQ notes, open source pages and read your current page."
          : "Model loaded (fast mode) — I answer from the notes I retrieve; page tools are off."
      );
    } catch (e) {
      engine = null;
      currentModelId = null;
      setStatus("error", "Model failed to load");
      addSystemMessage("Model load error: " + (e && e.message ? e.message : e));
    } finally {
      engineLoading = false;
    }
  }

  // ---- OpenAI-compatible endpoint (external provider) ----
  // Streams a standard POST {base}/chat/completions (OpenAI format) and
  // yields OpenAI-format chunks, so the agent loop and streaming UI are
  // shared between the in-browser WebLLM engine and any remote endpoint
  // (OpenRouter, Groq, OpenAI, vLLM, Ollama/llama.cpp local servers).
  function endpointBase() {
    var c = endpointCfg();
    return (c && c.baseUrl) ? String(c.baseUrl).replace(/\/+$/, "") : "";
  }
  async function openaiStream(request) {
    var c = endpointCfg();
    var body = Object.assign({}, request, {
      model: endpointModelName(),
      stream: true
    });
    var headers = { "Content-Type": "application/json" };
    if (c && c.key) headers["Authorization"] = "Bearer " + c.key;
    var res = await fetch(endpointBase() + "/chat/completions", {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      var detail = "";
      try { detail = (await res.text()).slice(0, 300); } catch (e) {}
      throw new Error("Endpoint HTTP " + res.status + (detail ? ": " + detail : ""));
    }
    var ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.indexOf("text/event-stream") < 0) {
      // Non-stream JSON response: wrap it as a single chunk.
      var data = await res.json();
      return (async function* () { yield data; })();
    }
    var reader = res.body.getReader();
    var decoder = new TextDecoder("utf-8");
    var buf = "";
    return (async function* () {
      while (true) {
        var part = await reader.read();
        if (part.done) break;
        buf += decoder.decode(part.value, { stream: true });
        var lines = buf.split("\n");
        buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line || line.indexOf("data:") !== 0) continue;
          var payload = line.slice(5).trim();
          if (payload === "[DONE]") return;
          try { yield JSON.parse(payload); } catch (e) { /* keep-alive or partial line */ }
        }
      }
    })();
  }
  // Streams a free-provider (site-provided) OpenAI-compatible request.
  // Unlike openaiStream it uses freeCfg (baseUrl/key/model) and a larger
  // max_tokens, because the Socrates model is a reasoning model.
  async function freeStream(request) {
    var c = freeCfg;
    if (!c) throw new Error("Free provider not available");
    var body = Object.assign({}, request, {
      model: c.model,
      stream: true,
      max_tokens: FREE_MAX_TOKENS
    });
    // The free model supports tool calling (verified at probe time):
    // keep the tools the agent loop passes so it can search, look up
    // and compute before answering.
    var headers = { "Content-Type": "application/json", "Authorization": "Bearer " + c.key };
    var res = await fetch(String(c.baseUrl).replace(/\/+$/, "") + "/chat/completions", {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      var detail = "";
      try { detail = (await res.text()).slice(0, 300); } catch (e) {}
      // 401/403 = key revoked/expired -> invalidate the free provider.
      if (res.status === 401 || res.status === 403) {
        invalidateFree("key rejected");
      }
      throw new Error("Free endpoint HTTP " + res.status + (detail ? ": " + detail : ""));
    }
    var ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.indexOf("text/event-stream") < 0) {
      var data = await res.json();
      return (async function* () { yield data; })();
    }
    var reader = res.body.getReader();
    var decoder = new TextDecoder("utf-8");
    var buf = "";
    return (async function* () {
      while (true) {
        var part = await reader.read();
        if (part.done) break;
        buf += decoder.decode(part.value, { stream: true });
        var lines = buf.split("\n");
        buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line || line.indexOf("data:") !== 0) continue;
          var payload = line.slice(5).trim();
          if (payload === "[DONE]") return;
          try { yield JSON.parse(payload); } catch (e) { /* keep-alive or partial line */ }
        }
      }
    })();
  }
  function isFreeAgent() { return !!(freeCfg && freeCfg.agent); }
  // Dispatch a completions request to the active provider. Both paths
  // return an async iterable of OpenAI-format chunks.
  function providerCreate(request) {
    if (isFree()) return freeStream(request);
    if (isExternal()) return openaiStream(request);
    return engine.chat.completions.create(request);
  }

  // ---- Agent tools ----
  // Most tools live in tools.js (same scope): TOOL_LIB (executors) and
  // TOOL_SCHEMAS (OpenAI function schemas). The two browser-bound tools
  // (navigate_to_page, read_current_page) need DOM access, so their
  // schemas are defined here and their execution handled in executeTool.
  // TOOLS = the FULL suite (62) — used by external endpoints, whose models
  // have big contexts.
  var TOOLS = TOOL_SCHEMAS.concat([
    {
      type: "function",
      function: {
        name: "navigate_to_page",
        description:
          "Open a FAQ note page in the user's browser so they can read it. Use ONLY when the user explicitly wants the page opened ('show me the page', 'open it'). Use a slug returned by a search/lookup tool. After opening, still write the answer.",
        parameters: {
          type: "object",
          properties: {
            slug: { type: "string", description: "Note slug exactly as returned by a tool" }
          },
          required: ["slug"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "read_current_page",
        description:
          "Read the text of the page the user is currently viewing. This is the ONLY tool for questions about 'this page' / 'the current page' / 'summarize this page'. Call it first (NOT search_notes) for those, then answer directly from its returned text.",
        parameters: {
          type: "object",
          properties: {
            max_chars: { type: "integer", description: "Max characters to return (default 1200)" }
          },
          required: []
        }
      }
    }
  ]);

  // ---- In-browser (WebLLM) tool subset ----
  // The in-browser Hermes-3 8B model has a 4,096-token context window and
  // WebLLM serializes EVERY tool schema into the prompt. All 62 full schemas
  // (~5,000 tokens) blow past the window and every request fails with
  // "Prompt tokens exceed context window size". So for the WebLLM path we
  // expose a curated 14-tool subset with short descriptions (~2 KB total);
  // executeTool still runs ANY registered tool, so if the model names a
  // fuller-sibling (e.g. score_history) it works anyway. External endpoints
  // (big contexts) keep the full TOOLS.
  var WEBLLM_TOOLS = [
    { name: "search_notes", desc: "Keyword-search the FAQ notes. Returns results with a short_answer; use read_note(id) for full text.",
      params: { query: strParam("Search keywords"), limit: intParam("Max results (default 5, max 10)") }, req: ["query"] },
    { name: "web_search", desc: "Search the INTERNET (Wikipedia + DuckDuckGo) for topics the site notes do NOT cover (CS job market, salaries, industry news, general CS knowledge). Use as a FALLBACK when search_notes has no answer, so you can still give a best-effort answer.",
      params: { query: strParam("Web search keywords"), limit: intParam("Max results (default 5, max 8)") }, req: ["query"] },
    { name: "read_note", desc: "Full text of one note by id (from search_notes/list_notes).",
      params: { id: intParam("Note id"), slug: strParam("Or note slug"), max_chars: intParam("Max chars (default 2200)") }, req: [] },
    { name: "list_folders", desc: "List the site's note sections with note counts.", params: {}, req: [] },
    { name: "get_jupas_code", desc: "JUPAS code(s) for a CS programme; empty name lists all CS JUPAS codes.",
      params: { programme: strParam("Programme name, e.g. 'Computer Science'") }, req: [] },
    { name: "get_nonjupas_code", desc: "Non-JUPAS admission code(s) for a CS programme (e.g. 1561A).",
      params: { programme: strParam("Programme name") }, req: [] },
    { name: "get_programme_info", desc: "One programme's profile (streams, duration, overview).",
      params: { code: strParam("Programme code, e.g. JS1204"), name: strParam("Or programme name") }, req: [] },
    { name: "get_cityu_score", desc: "CityU's published JUPAS score (median + lower quartile) for a code/year.",
      params: { code: strParam("Programme code, e.g. JS1204"), year: intParam("Year 2023-2026") }, req: ["code"] },
    { name: "get_all_cityu_scores", desc: "CityU scores for all CS programmes, optionally one year.",
      params: { year: intParam("Year"), limit: intParam("Max rows (default 20)") }, req: [] },
    { name: "lookup_grade_score", desc: "Convert DSE grades to the weighted JUPAS score and compare to CityU CS.",
      params: { grades: strParam("Up to 5 grades, e.g. '5,4,4,3,3'"), code: strParam("Programme code, default JS1204") }, req: ["grades"] },
    { name: "get_tuition_fees", desc: "Undergraduate tuition fees (local vs non-local).",
      params: { programme: strParam("Optional programme") }, req: [] },
    { name: "get_jupas_key_dates", desc: "JUPAS application key dates / deadlines for a cycle year.",
      params: { year: intParam("Cycle year, e.g. 2027") }, req: [] },
    { name: "get_entry_requirements", desc: "Minimum entrance requirements for a CS programme.",
      params: { code: strParam("Programme code"), name: strParam("Or programme name") }, req: [] },
    { name: "navigate_to_page", desc: "Open a note page in the browser (slug from a tool). Only when the user wants it opened; still write the answer.",
      params: { slug: strParam("Note slug from a tool result") }, req: ["slug"] },
    { name: "read_current_page", desc: "Read the text of the page the user is viewing. ONLY tool for 'this page'/'summarize this page'; then answer from its text.",
      params: { max_chars: intParam("Max chars (default 1200)") }, req: [] }
  ].map(function (t) {
    var props = {};
    (function () { for (var k in t.params) props[k] = t.params[k]; })();
    return {
      type: "function",
      function: {
        name: t.name,
        description: t.desc,
        parameters: { type: "object", properties: props, required: t.req }
      }
    };
  });

  function findEntryBySlug(slug) {
    if (!knowledgeIndex) return null;
    for (var i = 0; i < knowledgeIndex.length; i++) {
      if (knowledgeIndex[i].slug === slug) return knowledgeIndex[i];
    }
    return null;
  }

  function currentPageMeta() {
    var slug =
      (document.body.dataset && document.body.dataset.slug) ||
      location.pathname.slice(BASE.length).replace(/^\//, "");
    return { title: document.title || "", slug: slug };
  }
  // Visible article text of the current page (trimmed) — used as a context
  // fallback for the Phase-2 answer when no tool ran (e.g. the model emitted a
  // degenerate empty tool-call array).
  function currentPageText(maxChars) {
    var art = document.querySelector("article");
    var text = art ? art.textContent.replace(/\s+/g, " ").trim() : "";
    var n = maxChars || PAGE_READ_MAX;
    return text.slice(0, n);
  }

  // A short window of the note text around the first matched keyword.
  function snippetFor(entry, query) {
    var text = (entry.text || "").replace(/\s+/g, " ");
    var terms = query.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter(Boolean);
    var lower = text.toLowerCase();
    var pos = -1;
    for (var i = 0; i < terms.length; i++) {
      pos = lower.indexOf(terms[i]);
      if (pos >= 0) break;
    }
    if (pos < 0) return text.slice(0, 260);
    var start = Math.max(0, pos - 90);
    var end = Math.min(text.length, pos + 170);
    return (start > 0 ? "\u2026" : "") + text.slice(start, end) + (end < text.length ? "\u2026" : "");
  }

  // Collect source slugs from a tool result (for the citations footer) so
  // we don't have to special-case every tool.
  function collectCited(result, cited) {
    if (!result || typeof result !== "object") return;
    var found = {};
    (function walk(o, depth) {
      if (!o || depth > 3 || foundCount(found) >= CITE_SHOW) return;
      if (typeof o === "object" && !Array.isArray(o)) {
        if (o.slug && o.title) found[o.slug] = o.title;
        for (var k in o) if (o[k] && typeof o[k] === "object") walk(o[k], depth + 1);
      } else if (Array.isArray(o)) {
        for (var i = 0; i < o.length && foundCount(found) < CITE_SHOW; i++) walk(o[i], depth + 1);
      }
    })(result, 0);
    var n = 0;
    for (var s in found) { if (!cited[s] && n < CITE_SHOW) { cited[s] = found[s]; n++; } }
  }
  function foundCount(found) { var c = 0; for (var k in found) c++; return c; }

  // Run a tool. Registry tools (tools.js) are async-aware; the two
  // browser-bound tools are handled inline. Always returns a plain object.
  async function executeTool(name, args, cited) {
    args = args || {};
    if (name === "navigate_to_page") {
      var slug = normStrLocal(args.slug);
      if (!slug) return { ok: false, error: "slug is required" };
      var entry = findEntryBySlug(slug);
      if (!entry) {
        return { ok: false, error: "No note with slug \"" + slug + "\". Use a slug returned by a search/lookup tool." };
      }
      var url;
      try { url = new URL(BASE + "/" + slug, location.href); }
      catch (e) { return { ok: false, error: "Invalid slug: " + slug }; }
      try {
        if (typeof window.spaNavigate === "function") window.spaNavigate(url);
        else location.assign(url.href);
      } catch (e) {
        return { ok: false, error: "Navigation failed: " + (e && e.message ? e.message : String(e)) };
      }
      return { ok: true, opened: entry.title, slug: slug, url: url.href, note: "The page in the user's browser changed to this note. Share the url value (the full published URL) if the user wants the link." };
    }
    if (name === "read_current_page") {
      var max = Math.min(parseInt((args && args.max_chars), 10) || PAGE_READ_MAX, 2000);
      var art = document.querySelector("article");
      var text = art ? art.textContent.replace(/\s+/g, " ").trim() : "";
      return {
        ok: true,
        title: document.title || "",
        slug: currentPageMeta().slug,
        text: text.slice(0, max)
      };
    }
    var fn = TOOL_LIB[name];
    if (!fn) return { ok: false, error: "Unknown tool: " + name };
    var result = await fn(args, {
      BASE: BASE,
      document: document,
      location: location
    });
    collectCited(result, cited);
    return result;
  }
  function normStrLocal(v) { return String(v == null ? "" : v).trim(); }

  // ---- Agent loop (WebLLM OpenAI-style tool calling) ----
  //
  // WebLLM 0.2.85, for Hermes models with `tools` present:
  //   - rejects any custom system message (it injects its own)
  //   - forces the output to the Hermes tool-call JSON schema
  //   - streams the raw JSON as delta.content; the FINAL chunk carries
  //     delta.tool_calls and finish_reason "tool_calls"
  // So: buffer each turn; if it ends with tool_calls, replace the
  // (JSON) text with chips, execute the tools, push the assistant JSON
  // turn plus {role:"tool"} results, and loop. A turn that ends with
  // plain text is the final answer.
  function mergeToolCallsDelta(acc, deltaArr) {
    if (!deltaArr) return acc;
    var out = acc || [];
    for (var i = 0; i < deltaArr.length; i++) {
      var d = deltaArr[i];
      var idx = d.index != null ? d.index : i;
      if (!out[idx]) out[idx] = { name: "", arguments: "", id: "" };
      if (d.id) out[idx].id = d.id;
      if (d.function && d.function.name) out[idx].name += d.function.name;
      if (d.function && d.function.arguments != null) out[idx].arguments += d.function.arguments;
    }
    return out;
  }

  // Lenient JSON parse (undefined on failure).
  function jsonParseLoose(text) {
    try { return JSON.parse(String(text).trim()); } catch (e) { return undefined; }
  }
  // Interpret a grammar-locked Phase-1 output (streamed as delta.content) as
  // tool calls. WebLLM usually also emits a structured delta.tool_calls in the
  // final chunk, but that chunk can be missing/empty — in which case the only
  // usable signal is the JSON text. Accepts: an array of tool calls, a single
  // tool-call object, or {tool_calls:[...]}. Entries may be OpenAI-style
  // {function:{name,arguments}} or flat {name,arguments}. Returns an array of
  // {name,arguments,id} or null (NOT a tool call — including the degenerate
  // empty array "[]" the model sometimes emits).
  function coerceToolCalls(v) {
    if (!v || typeof v !== "object") return null;
    if (!Array.isArray(v)) {
      if (v.tool_calls && typeof v.tool_calls === "object") v = v.tool_calls;
      else v = [v];
    }
    if (!Array.isArray(v) || !v.length) return null;
    var out = [];
    for (var i = 0; i < v.length; i++) {
      var e = v[i];
      if (!e || typeof e !== "object") continue;
      var name = e.name || (e.function && e.function.name) || "";
      var args = e.arguments != null ? e.arguments : (e.function && e.function.arguments != null ? e.function.arguments : "");
      if (typeof args === "object") { try { args = JSON.stringify(args); } catch (err) { args = ""; } }
      if (!name) continue;
      out.push({ name: String(name), arguments: String(args), id: e.id || ("t" + i) });
    }
    return out.length ? out : null;
  }

  function safeParseArgs(s) {
    if (!s) return {};
    try {
      var v = JSON.parse(s);
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch (e) { return {}; }
  }

  function buildAgentUserTurn(query) {
    var page = currentPageMeta();
    var ctx =
      "You are the FAQ assistant for the CityUHK (City University of Hong Kong) " +
      "Computer Science undergraduate admission site. " +
      "How to use your tools:\n" +
      "- If the user refers to the current/this page (e.g. \"summarize this page\"): " +
      "call read_current_page IMMEDIATELY and do NOT call search_notes — the page IS the source.\n" +
      "- For any other question: pick the MOST SPECIFIC tool that matches the intent. " +
      "There are purpose-specific tools — for JUPAS codes use get_jupas_code, for non-JUPAS " +
      "codes get_nonjupas_code, for a score get_cityu_score, for grades " +
      "lookup_grade_score, for fees get_tuition_fees, for a programme get_programme_info, for a " +
      "course get_course_info, and so on. Only use the generic search_notes when no specific tool fits.\n" +
     "- FALLBACK TO THE WEB: if search_notes (or a specific tool) comes up empty or clearly " +
     "lacks the answer (e.g. the CS job market / salaries / demand, industry trends, what " +
     "graduates do, or any general-knowledge topic), call web_search(query) and answer from " +
     "its results, citing the source title(s). Do NOT just reply 'the notes do not contain " +
     "this'; give the best-effort answer. Site notes stay authoritative for CityU admission " +
     "facts; web results are general knowledge.\n" +
      "- After a tool returns data with ok=true, that data IS your source: answer from it. " +
      "Do NOT call the same or a similar tool again to \"double-check\". At most 2 tool calls " +
     "per question, then answer (a search that finds nothing does NOT count as an answer \u2014 " +
     "it is the trigger for web_search).\n" +
      "Be concise and factual. Answer from what the tools and the page return; if even the web " +
      "fallback has nothing, say so plainly and give your best general-knowledge answer, clearly " +
      "labelled as such. If the user asked you to open/show a page, call " +
      "navigate_to_page once AND still write the answer.\n" +
      "The site is published at " + location.origin + BASE + " — so a note's full public URL is " +
      location.origin + BASE + "/<slug> (e.g. " + location.origin + BASE + "/03_nonjupas/bsc-cs-non-jupas-code-1561a). " +
      "If the user asks for the link/URL of a page, give the full URL as a markdown link, e.g. [Title](" + location.origin + BASE + "/<slug>).\n";
    if (page.title) ctx += " Current page: " + page.title + " (slug: " + page.slug + ").";
    return ctx + "\n\n" + query;
  }

  // System prompt for Phase 2 (the no-tools answer round). A custom system
  // prompt is only legal on a request WITHOUT tools (WebLLM rejects it when
  // tools are present), so this is where the model gets its answer instructions.
  function buildAnswerSystem() {
    return (
      "You are the FAQ assistant for the CityUHK (City University of Hong Kong) " +
      "Computer Science undergraduate admission site. The user asked a question " +
      "and a site tool has already been run for you; its result is provided " +
      "below. Write the final answer NOW in plain text (no JSON, no tool calls). " +
      "Be concise and factual, and answer from the provided content. If the site " +
      "notes do not contain the answer (e.g. CS job market, salaries, industry " +
      "trends), give a best-effort general-knowledge answer clearly labelled as " +
      "such — do NOT just say 'the notes do not contain this'. Cite the note " +
      "titles and any web source titles given; for CityU admission facts the " +
      "site notes are authoritative."
    );
  }

  // User message for Phase 2: the original question plus the tool result as text.
  function buildAnswerTurn(query, toolNote) {
    var s = "User question: " + query + "\n\n";
    if (toolNote) {
      s += "Tool result from the site:\n" + toolNote + "\n";
    } else {
      s += "(No tool result was available. Use the current page content below as " +
        "your source.)\n\n";
    }
    // When no tool ran, the model would otherwise have nothing to answer from.
    // Include the current page so it can still give a real answer (this is the
    // path taken when the Phase-1 model emitted a degenerate "[]" tool call).
    if (!toolNote) {
      var page = currentPageMeta();
      var pt = currentPageText(1500);
      if (page.title) s += "Current page title: " + page.title + "\n";
      if (pt) s += "Current page content:\n" + pt + "\n";
    }
    s += "Answer the user question now in plain text. Never output raw JSON, " +
      "tool calls, or empty answers.";
    return s;
  }

  // Enumeration queries ("list ALL …", "every …", "each …", "all the …") need
  // to retrieve several notes before they can be answered completely, so the
  // agent loop grants them a bigger tool-call budget than the default of 2.
  function isEnumerative(query) {
    var q = String(query || "").toLowerCase();
    return /\b(all|every|each|a (list|roundup|round-up|breakdown|summary) of|all the)\b/.test(q)
      || /\b(list|show|give me|tell me)\b[^.!?]{0,40}\b(all|every|each|different|distinct|whole|complete|entire)\b/.test(q);
  }

  // ---- Agent loop for EXTERNAL OpenAI-compatible endpoints.
  // Standard OpenAI tool-calling loop: no grammar lock, so the model can
  // answer directly or call tools; tool results go back as role:"tool".
  async function runAgentExternal(query) {
    var history = [];
    var plain = conversationHistory.filter(function (m) {
      return (m.role === "user" || m.role === "assistant") && typeof m.content === "string";
    });
    if (plain.length && plain[plain.length - 1].role === "user" && plain[plain.length - 1].content === query) {
      plain = plain.slice(0, -1);
    }
    plain.slice(-AGENT_HISTORY).forEach(function (m) {
      var c = m.content;
      if (m.role === "assistant" && c.length > AGENT_TURN_TRIM) c = c.slice(0, AGENT_TURN_TRIM) + "\u2026";
      history.push({ role: m.role, content: c });
    });

    var cited = {};
    var page = currentPageMeta();
    // Enumeration queries ("all …", "every …", "each …") get a bigger tool-call
    // budget so the agent can retrieve every matching note before answering;
    // everything else keeps the fast 2-call default.
    var enumerative = isEnumerative(query);
    var maxToolCalls = enumerative ? 6 : 2;
    var maxRounds = enumerative ? 8 : MAX_AGENT_TURNS;
    var systemPrompt =
      "You are the FAQ assistant for the CityUHK (City University of Hong Kong) " +
      "Computer Science undergraduate admission site. You have many purpose-specific " +
      "tools. Rules: (1) For questions about the current/this page, use read_current_page " +
      "and answer from its text. (2) For other questions, call the MOST SPECIFIC tool that " +
      "matches the intent (e.g. get_jupas_code, get_cityu_score, get_tuition_fees, " +
      "get_programme_info, lookup_grade_score, run_python for computation); use the generic " +
      "search_notes only when nothing specific fits. (3) Once a tool returns ok=true data, " +
      "answer from it — do NOT re-call a similar tool to double-check; at most " + maxToolCalls + " tool calls " +
      "per question, then answer. For a COMPLETE list (\"all\", \"every\", \"each\"), retrieve " +
      "each matching note (search then read_note on each) before answering, and use the " +
      "note's full text — read_note's offset/next_offset reads past the first part of a " +
      "long note. (3b) FALLBACK TO THE WEB: when the notes have no answer (job market, " +
      "salaries, industry trends, general CS knowledge), call web_search and answer from its " +
      "results, citing the source title(s) and noting it is general web knowledge — do NOT " +
      "just reply 'the notes do not contain this'. (4) Be concise and factual; if even the web " +
      "fallback has nothing, say so plainly and give your best general-knowledge answer, " +
      "clearly labelled as such. (5) If the user wants a page opened, call navigate_to_page " +
      "once AND still " +
      "write the answer. (6) The site is published at " + location.origin + BASE + ", so a " +
      "note's full public URL is " + location.origin + BASE + "/<slug>; if the user asks for a " +
      "page's link/URL, give the full URL (the navigate_to_page result includes it as url)." +
      (page.title ? " Current page: " + page.title + " (slug: " + page.slug + ")." : "");
    var msgs = [{ role: "system", content: systemPrompt }]
      .concat(history)
      .concat([{ role: "user", content: buildAgentUserTurn(query) }]);

    for (var round = 0; round < maxRounds; round++) {
      showTyping(true);
      var req = {
        messages: msgs.slice(),
        temperature: 0.3,
        max_tokens: 1024,
        stream: true,
        tool_choice: "auto",
        tools: TOOLS
      };
      if (window.__aiChatLog) console.log("[ai-chat] EXT round " + round + " REQUEST", JSON.parse(JSON.stringify(req)));
      var stream = await providerCreate(req);
      var content = "";
      var toolCalls = null;
      var liveEl = null;
      for await (var chunk of stream) {
        var choice = chunk.choices && chunk.choices[0];
        if (!choice) continue;
        var delta = choice.delta;
        if (delta && delta.content) {
          content += delta.content;
          if (!liveEl) {
            showTyping(false);
            liveEl = appendMessage("assistant", "");
          }
          liveEl.innerHTML = renderMarkdown(content);
          scrollBottom();
        }
        if (delta && delta.tool_calls) toolCalls = mergeToolCallsDelta(toolCalls, delta.tool_calls);
      }
      showTyping(false);
      if (window.__aiChatLog) console.log("[ai-chat] EXT round " + round + " RESPONSE", JSON.stringify({ content: content, toolCalls: toolCalls }));

      if (!toolCalls || !toolCalls.length) {
        // Final answer.
        var finalEl = liveEl;
        if (!finalEl && content) finalEl = appendMessage("assistant", content);
        if (finalEl && content) {
          finalEl.innerHTML = renderMarkdown(content);
          appendCitations(finalEl, cited);
          typesetIfReady(finalEl);
          scrollBottom();
        }
        conversationHistory.push({ role: "assistant", content: content });
        if (!content.trim()) addSystemMessage("(The model returned an empty answer)");
        return;
      }

      // Tool-call turn: raw JSON text streamed — swap it for chips.
      if (liveEl) liveEl.remove();
      var tcArr = [];
      for (var ti = 0; ti < toolCalls.length; ti++) {
        var tc = toolCalls[ti];
        var argsObj = safeParseArgs(tc.arguments);
        var t = { name: tc.name, arguments: argsObj, id: tc.id || ("call_" + ti) };
        addToolChip(t.name, t.arguments);
        tcArr.push({
          id: t.id,
          type: "function",
          function: { name: t.name, arguments: JSON.stringify(t.arguments) }
        });
      }
      msgs.push({ role: "assistant", content: content || null, tool_calls: tcArr });
      for (var k = 0; k < tcArr.length; k++) {
        var result = await executeTool(tcArr[k].function.name, safeParseArgs(tcArr[k].function.arguments), cited);
        msgs.push({ role: "tool", tool_call_id: tcArr[k].id, content: JSON.stringify(result).slice(0, TOOL_RESULT_MAX) });
      }
    }
    // Loop exhausted without a plain answer: force a final answer round with
    // NO tools (mirrors the WebLLM two-phase pattern) so the user still gets
    // an answer assembled from the tool results gathered so far.
    if (window.__aiChatLog) console.log("[ai-chat] EXT: forcing final answer (no tools)");
    showTyping(true);
    var forcedReq = {
      messages: msgs.slice().concat([{
        role: "user",
        content: "You have already gathered the tool results above. Now write the final answer to the user's question in plain text (no JSON, no more tool calls). Be concise and factual; if the results don't contain the answer, say so."
      }]),
      temperature: 0.3,
      max_tokens: 1024,
      stream: true
    };
    var fStream = await providerCreate(forcedReq);
    var fReply = "";
    var fEl = appendMessage("assistant", "");
    var fInner = el("div", { className: "ai-chat-md" });
    if (fEl) fEl.appendChild(fInner);
    var fSrcDone = false;
    for await (var fChunk of fStream) {
      var fd = (fChunk.choices && fChunk.choices[0] && fChunk.choices[0].delta && fChunk.choices[0].delta.content) || "";
      if (!fd) continue;
      fReply += fd;
      if (fEl) {
        fInner.innerHTML = renderMarkdown(fReply);
        if (!fSrcDone) { appendCitations(fEl, cited); fSrcDone = true; }
        scrollBottom();
      }
    }
    showTyping(false);
    typesetIfReady(fEl);
    if (window.__aiChatLog) console.log("[ai-chat] EXT forced RESPONSE", JSON.stringify(fReply));
    conversationHistory.push({ role: "assistant", content: fReply });
    if (!fReply.trim()) addSystemMessage("I ran out of steps and could not assemble an answer — please rephrase or split the question.");
  }

  async function runAgent(query) {
    if (isExternal()) return runAgentExternal(query);
    // Recent plain exchanges (tool turns are not kept in history). The
    // current user query was already pushed by sendMessage — exclude it
    // here; Phase 1 appends the context-wrapped version.
    var history = [];
    var plain = conversationHistory.filter(function (m) {
      return (m.role === "user" || m.role === "assistant") && typeof m.content === "string";
    });
    if (plain.length && plain[plain.length - 1].role === "user" && plain[plain.length - 1].content === query) {
      plain = plain.slice(0, -1);
    }
    plain.slice(-AGENT_HISTORY).forEach(function (m) {
      var c = m.content;
      if (m.role === "assistant" && c.length > AGENT_TURN_TRIM) c = c.slice(0, AGENT_TURN_TRIM) + "\u2026";
      history.push({ role: m.role, content: c });
    });

    var cited = {};

    // ------------------------------------------------------------------
    // PHASE 1 — tool selection (grammar-locked by WebLLM).
    //
    // When `tools` is present, WebLLM 0.2.85 forces
    //   request.response_format = { type:"json_object", schema:<tool-call
    //   array> }  and grammar-locks the output to that schema
    // (postInitAndCheckFields, lib/index.js ~12152). The model therefore
    // CANNOT emit a plain-text answer on a request that carries `tools` —
    // it is forced to emit a tool call. So this round only ever returns
    // tool call(s); we execute them and collect the result.
    // ------------------------------------------------------------------
    showTyping(true);
    var toolRequest = {
      messages: history.concat([{ role: "user", content: buildAgentUserTurn(query) }]),
      temperature: 0.3,
      max_tokens: 1024,
      stream: true,
      tool_choice: "auto",
      tools: WEBLLM_TOOLS
    };
    if (window.__aiChatLog) console.log("[ai-chat] PHASE1 (tools) REQUEST", JSON.parse(JSON.stringify(toolRequest)));
    var stream1 = await providerCreate(toolRequest);
    var content1 = "";
    var toolCalls = null;
    var liveEl = null;
    for await (var chunk of stream1) {
      var choice = chunk.choices && chunk.choices[0];
      if (!choice) continue;
      var delta = choice.delta;
      if (delta && delta.content) {
        content1 += delta.content;
        if (!liveEl) {
          showTyping(false);
          liveEl = appendMessage("assistant", "");
        }
        liveEl.innerHTML = renderMarkdown(content1);
        scrollBottom();
      }
      if (delta && delta.tool_calls) toolCalls = mergeToolCallsDelta(toolCalls, delta.tool_calls);
    }
    showTyping(false);
    if (window.__aiChatLog) console.log("[ai-chat] PHASE1 RESPONSE", JSON.stringify({ content: content1, toolCalls: toolCalls }));

    // If the structured delta.tool_calls chunk was missing/empty, the JSON
    // tool call(s) may still be in the streamed text — try to recover them.
    // (Also guards the degenerate "[]" the model sometimes emits.)
    if ((!toolCalls || !toolCalls.length) && content1.trim()) {
      var parsed = jsonParseLoose(content1);
      var coerced = coerceToolCalls(parsed);
      if (coerced) toolCalls = coerced;
    }

    var toolNote = ""; // human-readable tool result, fed to Phase 2

    if (toolCalls && toolCalls.length) {
      // Tool-call turn: the streamed text is the raw JSON — swap it for chips.
      if (liveEl) liveEl.remove();
      for (var ti = 0; ti < toolCalls.length; ti++) {
        var tc = toolCalls[ti];
        var argsObj = safeParseArgs(tc.arguments);
        var t = { name: tc.name, arguments: argsObj };
        addToolChip(t.name, t.arguments);
        var result = await executeTool(t.name, t.arguments, cited);
        toolNote +=
          "Tool " + t.name + "(" + JSON.stringify(t.arguments) + ") returned:\n" +
          JSON.stringify(result).slice(0, TOOL_RESULT_MAX) + "\n\n";
      }
    } else if (content1.trim()) {
      // No tool call. Only treat this as a final answer if it reads like plain
      // text — NOT a leftover tool-call JSON fragment (some 8B grammar-locked
      // models emit a malformed tool JSON as content), which would otherwise be
      // dumped verbatim. JSON-shaped text falls through to Phase 2, which gives
      // a proper answer from context.
      var looksJson = /^\s*[\[{]/.test(content1);
      var parsedC = jsonParseLoose(content1);
      if (looksJson && (coerceToolCalls(parsedC) || parsedC !== undefined)) {
        // JSON that isn't a usable tool call (e.g. "[]" or malformed) ->
        // don't display it; let Phase 2 answer from context below.
        if (liveEl) liveEl.remove();
      } else {
        var el1 = liveEl;
        if (!el1 && content1) el1 = appendMessage("assistant", content1);
        if (el1 && content1) {
          el1.innerHTML = renderMarkdown(content1);
          appendCitations(el1, cited);
          typesetIfReady(el1);
          scrollBottom();
        }
        conversationHistory.push({ role: "assistant", content: content1 });
        return;
      }
    }

    // ------------------------------------------------------------------
    // PHASE 1.5 — optional SECOND tool round (enumeration queries only).
    //
    // The default path retrieves once then answers. For "all / every / each"
    // questions a single retrieval is incomplete (e.g. "all double-degree
    // programmes" needs more than the first match). When the query is
    // enumerative and Phase 1 already retrieved something, run one more
    // grammar-locked tool round so the model can read_note the remaining
    // matching notes before the final answer. Bounded to a single extra round.
    // ------------------------------------------------------------------
    if (isEnumerative(query) && toolNote.trim()) {
      if (window.__aiChatLog) console.log("[ai-chat] PHASE1.5 (2nd tool round) for enumerative query");
      showTyping(true);
      var toolRequest2 = {
        messages: [{ role: "user", content:
          "User question: " + query + "\n\nTool results so far:\n" + toolNote.slice(0, 4000) +
          "\n\nTo answer a COMPLETE list, call read_note(id) on every matching note id you have not yet read, and/or search_notes with a narrower keyword to find any you missed. Retrieve ALL matching notes before answering."
        }],
        temperature: 0.3,
        max_tokens: 1024,
        stream: true,
        tool_choice: "auto",
        tools: WEBLLM_TOOLS
      };
      var stream1b = await providerCreate(toolRequest2);
      var content1b = "";
      var toolCalls1b = null;
      var live1b = null;
      for await (var chunk1b of stream1b) {
        var c1b = chunk1b.choices && chunk1b.choices[0];
        if (!c1b) continue;
        var d1b = c1b.delta;
        if (d1b && d1b.content) {
          content1b += d1b.content;
          if (!live1b) { showTyping(false); live1b = appendMessage("assistant", ""); }
          live1b.innerHTML = renderMarkdown(content1b);
          scrollBottom();
        }
        if (d1b && d1b.tool_calls) toolCalls1b = mergeToolCallsDelta(toolCalls1b, d1b.tool_calls);
      }
      showTyping(false);
      if ((!toolCalls1b || !toolCalls1b.length) && content1b.trim()) {
        var p1b = jsonParseLoose(content1b);
        var co1b = coerceToolCalls(p1b);
        if (co1b) toolCalls1b = co1b;
      }
      if (toolCalls1b && toolCalls1b.length) {
        if (live1b) live1b.remove();
        for (var ti1b = 0; ti1b < toolCalls1b.length; ti1b++) {
          var tc1b = toolCalls1b[ti1b];
          var args1b = safeParseArgs(tc1b.arguments);
          var t1b = { name: tc1b.name, arguments: args1b };
          addToolChip(t1b.name, t1b.arguments);
          var r1b = await executeTool(t1b.name, t1b.arguments, cited);
          toolNote += "Tool " + t1b.name + "(" + JSON.stringify(t1b.arguments) + ") returned:\n" + JSON.stringify(r1b).slice(0, TOOL_RESULT_MAX) + "\n\n";
        }
      }
    }

    // ------------------------------------------------------------------
    // PHASE 2 — plain-text answer (no tools).
    //
    // Because this request has NO `tools`, WebLLM does not grammar-lock the
    // output and does not inject/restrict the system prompt — the model can
    // freely write a normal answer. The tool result is passed as TEXT inside
    // the user message (not a role:"tool" message) so we do not depend on the
    // chat template defining a "tool" role.
    // ------------------------------------------------------------------
    showTyping(true);
    var answerRequest = {
      messages: [
        { role: "system", content: buildAnswerSystem() },
        { role: "user", content: buildAnswerTurn(query, toolNote) }
      ],
      temperature: 0.3,
      max_tokens: 1024,
      stream: true
    };
    if (window.__aiChatLog) console.log("[ai-chat] PHASE2 (answer) REQUEST", JSON.parse(JSON.stringify(answerRequest)));
    var stream2 = await providerCreate(answerRequest);
    var reply = "";
    var msgEl = appendMessage("assistant", "");
    // Render markdown into an inner wrapper so the citations element (a
    // sibling) survives the per-delta innerHTML re-render.
    var inner = el("div", { className: "ai-chat-md" });
    if (msgEl) msgEl.appendChild(inner);
    var srcDone = false;
    for await (var chunk of stream2) {
      var d =
        (chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content) || "";
      if (!d) continue;
      reply += d;
      if (msgEl) {
        inner.innerHTML = renderMarkdown(reply);
        if (!srcDone) {
          appendCitations(msgEl, cited);
          srcDone = true;
        }
        scrollBottom();
      }
    }
    showTyping(false);
    typesetIfReady(msgEl);
    if (window.__aiChatLog) console.log("[ai-chat] PHASE2 RESPONSE", JSON.stringify(reply));
    conversationHistory.push({ role: "assistant", content: reply });
    if (!reply.trim()) addSystemMessage("(The model returned an empty answer)");
  }

  // ---- Fast path: RAG-only single completion (no tools) ----
  async function fastAnswer(query) {
    var sources = retrieve(query, TOP_K);
    var article = document.querySelector("article");
    var pageContext = article
      ? article.textContent.replace(/\s+/g, " ").trim().slice(0, 1200)
      : "";

    var context =
      "You are a helpful assistant for the CityUHK (City University of Hong Kong) " +
      "Computer Science undergraduate admission FAQ site (fast mode: no page tools). " +
      "Answer based on the retrieved notes below. Be concise and factual. " +
      "If the notes do not contain an answer, say you are unsure and suggest " +
      "searching the site. When an answer uses several notes, cite ALL the " +
      "relevant note names (more is better for verification) so the user can " +
      "open each one.\n\n";
    if (pageContext) {
      context += "=== Current page: " + (document.title || "") + " ===\n" + pageContext + "\n\n";
    }
    if (sources.length) {
      context += "=== Retrieved notes ===\n";
      for (var i = 0; i < sources.length; i++) {
        context += "--- " + sources[i].title + " (" + sources[i].slug + ") ---\n" + sources[i].text.slice(0, 800) + "\n\n";
      }
    } else {
      context += "=== No relevant notes found. Be cautious and say you are unsure if you do not know. ===\n";
    }

    var messages = [{ role: "system", content: context }].concat(
      conversationHistory.slice(-HISTORY_KEEP)
    );
    var stream = await providerCreate({
      messages: messages,
      temperature: 0.3,
      max_tokens: 1024,
      stream: true
    });
    var msgEl = appendMessage("assistant", "");
    // Render markdown into an inner wrapper so the citations element (a
    // sibling) survives the per-delta innerHTML re-render.
    var inner = el("div", { className: "ai-chat-md" });
    if (msgEl) msgEl.appendChild(inner);
    var reply = "";
    var srcDone = !sources.length;
    for await (var chunk of stream) {
      var delta =
        (chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content) || "";
      if (!delta) continue;
      reply += delta;
      if (msgEl) {
        inner.innerHTML = renderMarkdown(reply);
        if (!srcDone) {
          appendCitations(msgEl, sources);
          srcDone = true;
        }
        scrollBottom();
      }
    }
    showTyping(false);
    typesetIfReady(msgEl);
    conversationHistory.push({ role: "assistant", content: reply });
    if (!reply.trim()) addSystemMessage("(model returned an empty reply)");
  }

  function setBusy(on) {
    var ta = document.getElementById("ai-chat-input");
    var btn = document.getElementById("ai-chat-send");
    // Don't disable the textarea itself: it steals focus while generating and
    // it's not needed (isGenerating already guards double-send). Keeping it
    // enabled lets focus be restored for an immediate follow-up.
    if (btn) btn.disabled = on;
    if (ta) ta.placeholder = on ? "Thinking\u2026" : ta.dataset.ph || ta.placeholder;
  }

  // ---- Send message ----
  async function sendMessage() {
    var inputEl = document.getElementById("ai-chat-input");
    var sendBtn = document.getElementById("ai-chat-send");
    if (!inputEl || isGenerating) return;
    var query = inputEl.value.trim();
    if (!query) return;

    inputEl.value = "";
    if (inputEl.style.height) inputEl.style.height = "";

    if (!providerReady()) {
      addSystemMessage(
        "No model loaded yet. Open \u2699\uFE0F settings and load a model or connect a server, then try again."
      );
      openSettings();
      return;
    }

    isGenerating = true;
    setBusy(true);
    appendMessage("user", query);
    conversationHistory.push({ role: "user", content: query });
    showTyping(true);

    try {
      // The free provider runs the FULL agent when its endpoint supports
      // tool calling (probed at startup); otherwise it stays on the
      // grounded RAG-only path.
      if (isFree() ? !isFreeAgent() : !(isExternal() || isAgentModel(currentModelId))) await fastAnswer(query);
      else await runAgent(query);
    } catch (e) {
      showTyping(false);
      addSystemMessage("Error: " + (e && e.message ? e.message : e));
    } finally {
      isGenerating = false;
      setBusy(false);
      // Keep the input focused so a follow-up can be typed immediately
      // (disabling the textarea during generation had stolen focus).
      var p = document.getElementById("ai-chat-panel");
      if (inputEl && p && !p.classList.contains("closed")) {
        try { inputEl.focus(); } catch (e) {}
      }
    }
  }

  // ---- Settings modal ----
  function openSettings() {
    var existing = document.getElementById("ai-chat-settings-overlay");
    if (existing) return;
    var overlay = el("div", {
      id: "ai-chat-settings-overlay",
      className: "ai-chat-settings-overlay",
      onclick: function (e) { if (e.target === overlay) overlay.remove(); }
    });
    var modal = el("div", { className: "ai-chat-settings" });
    modal.appendChild(el("h3", { textContent: "AI Chat Settings" }));

    // ---- Provider toggle: in-browser (WebGPU) vs Free (site) vs own server
    var providerGroup = el("div", { className: "settings-provider" });
    var radioIn = el("input", { type: "radio", name: "ai-chat-provider", id: "ai-chat-prov-in", value: "inbrowser" });
    var radioFree = el("input", { type: "radio", name: "ai-chat-provider", id: "ai-chat-prov-free", value: "free" });
    var radioOut = el("input", { type: "radio", name: "ai-chat-provider", id: "ai-chat-prov-out", value: "external" });
    var save = endpointCfg() || {};
    if (save.kind === "external") radioOut.checked = true;
    else if (isFree()) radioFree.checked = true;
    else radioIn.checked = true;
    providerGroup.appendChild(radioIn);
    providerGroup.appendChild(el("label", { for: "ai-chat-prov-in", textContent: " In-browser model (WebGPU — runs locally, no server)" }));
    providerGroup.appendChild(el("br"));
    providerGroup.appendChild(radioFree);
    providerGroup.appendChild(el("label", { for: "ai-chat-prov-free", textContent: " Free site AI (no setup" + (isFree() ? " — " + freeModelName() : "") + ")" }));
    providerGroup.appendChild(el("br"));
    providerGroup.appendChild(radioOut);
    providerGroup.appendChild(el("label", { for: "ai-chat-prov-out", textContent: " OpenAI-compatible server (e.g. OpenRouter, Groq, OpenAI, local llama.cpp/Ollama)" }));
    modal.appendChild(providerGroup);

    // ---- Free site-AI section (read-only; availability comes from the live probe)
    var freeSection = el("div", { className: "settings-section", id: "ai-chat-section-free" });
    var freeState = el("p", { className: "settings-hint" });
    if (isFree()) {
      freeState.textContent = "Available now — " + freeModelName() + ". I answer from the FAQ notes I retrieve for you. No key or setup needed.";
    } else {
      freeState.textContent = "Not currently available (the site's free AI service is off or its key is not active). If the site re-enables it, reload and choose this option again.";
    }
    freeSection.appendChild(freeState);
    modal.appendChild(freeSection);

    var inSection = el("div", { className: "settings-section", id: "ai-chat-section-in" });

    var label = el("label", { textContent: "Model (runs in your browser via WebGPU)" });
    var select = el("select", { id: "ai-chat-setting-model" });
    var saved = storageGetModel() || DEFAULT_MODEL;
    if (MODELS.indexOf(saved) < 0) saved = DEFAULT_MODEL;
    var ogAgent = el("optgroup", {
      label: "Agent \u2014 tool calling: searches the notes, opens pages, reads your current page (larger, \u22485 GB first load)"
    });
    AGENT_MODELS.forEach(function (m) {
      var opt = el("option", { value: m, textContent: m });
      if (m === saved) opt.selected = true;
      ogAgent.appendChild(opt);
    });
    var ogFast = el("optgroup", {
      label: "Fast \u2014 retrieved-note answers only, no page tools (smaller, \u22482 GB first load)"
    });
    FAST_MODELS.forEach(function (m) {
      var opt = el("option", { value: m, textContent: m });
      if (m === saved) opt.selected = true;
      ogFast.appendChild(opt);
    });
    select.appendChild(ogAgent);
    select.appendChild(ogFast);
    inSection.appendChild(label);
    inSection.appendChild(select);

    var hint = el("p", { className: "settings-hint" });
    hint.textContent =
      "Agent models can call tools: search the FAQ notes, open the source page in your browser, and read the page you are viewing. " +
      "Fast models answer from the notes I retrieve for you. " +
      "The model downloads once and is cached in your browser. Nothing is sent to any server.";
    inSection.appendChild(hint);
    modal.appendChild(inSection);

    // ---- OpenAI-compatible server section
    var outSection = el("div", { className: "settings-section", id: "ai-chat-section-out" });
    var baseLabel = el("label", { textContent: "Base URL (no trailing /chat/completions)" });
    var baseInput = el("input", {
      type: "text", id: "ai-chat-set-base",
      placeholder: "https://openrouter.ai/api/v1  or  http://localhost:8080/v1",
      value: (save && save.kind === "external") ? (save.baseUrl || "") : ""
    });
    var keyLabel = el("label", { textContent: "API key (optional for local servers; stored only in this browser)" });
    var keyInput = el("input", {
      type: "password", id: "ai-chat-set-key",
      placeholder: "sk-...",
      value: (save && save.kind === "external") ? (save.key || "") : ""
    });
    var modelLabel = el("label", { textContent: "Model name (must support tool calling for agent features)" });
    var modelInput = el("input", {
      type: "text", id: "ai-chat-set-model",
      placeholder: "openai/gpt-4o-mini  or  meta-llama/Llama-3.1-8B-Instruct",
      value: (save && save.kind === "external") ? (save.model || "") : ""
    });
    outSection.appendChild(baseLabel); outSection.appendChild(baseInput);
    outSection.appendChild(keyLabel); outSection.appendChild(keyInput);
    outSection.appendChild(modelLabel); outSection.appendChild(modelInput);
    outSection.appendChild(el("p", { className: "settings-hint", textContent:
      "Any OpenAI-compatible /chat/completions endpoint works (OpenRouter, Groq, OpenAI, Azure, vLLM, Ollama, llama.cpp llama-server). " +
      "Note: in this mode your questions are sent to that server." }));
    modal.appendChild(outSection);

    function refreshSections() {
      inSection.style.display = radioIn.checked ? "" : "none";
      outSection.style.display = radioOut.checked ? "" : "none";
      freeSection.style.display = radioFree.checked ? "" : "none";
    }
    radioIn.addEventListener("change", refreshSections);
    radioFree.addEventListener("change", refreshSections);
    radioOut.addEventListener("change", refreshSections);
    refreshSections();

    var actions = el("div", { className: "settings-actions" });
    actions.appendChild(el("button", {
      textContent: "Cancel",
      onclick: function () { overlay.remove(); }
    }));
    var applyBtn = el("button", { className: "primary" });
    function applyProvider() {
      if (radioFree.checked) {
        // Switch to the site free provider: clear any explicit choice so the
        // page (and a future reload) uses the free provider.
        clearEndpointCfg();
        storageClearModel();
        overlay.remove();
        (freeCfg ? Promise.resolve(freeCfg) : loadFreeConfig().then(function () { return freeCfg; })).then(function (cfg) {
          if (cfg) activateFree();
          else addSystemMessage("The free AI service is not available right now. It will be offered automatically when it comes back — or reload and try again.");
        });
        return;
      }
      // An explicit choice supersedes the auto free provider.
      clearFree();
      if (radioOut.checked) {
        var base = baseInput.value.trim();
        var key = keyInput.value.trim();
        var model = modelInput.value.trim();
        if (!base || !model) {
          addSystemMessage("External server needs both a Base URL and a Model name.");
          return;
        }
        saveEndpointCfg({ kind: "external", baseUrl: base, key: key, model: model });
        overlay.remove();
        activateExternal();
      } else {
        clearEndpointCfg();
        var chosen = select.value;
        storageSetModel(chosen);
        overlay.remove();
        addSystemMessage("Loading " + chosen + " \u2026 (first time takes a while)");
        loadEngine(chosen);
      }
    }
    applyBtn.onclick = applyProvider;
    function refreshButton() {
      applyBtn.textContent = radioOut.checked ? "Use server" : (radioFree.checked ? "Use free AI" : "Load model");
    }
    radioIn.addEventListener("change", refreshButton);
    radioFree.addEventListener("change", refreshButton);
    radioOut.addEventListener("change", refreshButton);
    refreshButton();
    actions.appendChild(applyBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.documentElement.appendChild(overlay);
  }

  // Switch to the external provider: no model download needed.
  function activateExternal() {
    var c = endpointCfg();
    if (!c || c.kind !== "external") return;
    currentModelId = c.model;
    setStatus("ready", "Server ready: " + c.model);
    addSystemMessage(
      "Connected to OpenAI-compatible server (" + c.model + "). " +
      "I can search the FAQ notes, open source pages and read your current page."
    );
  }

  function clearChat() {
    conversationHistory = [];
    showWelcome();
  }

  // The chat button (FAB) only OPENS the panel (it hides while the panel is
  // open); closing is the small X in the panel header, plus Escape. Both
  // controls are always reachable, so the chat can never get stuck.
  function togglePanel() {
    var panel = document.getElementById("ai-chat-panel");
    if (!panel) return;
    panelOpen = !panelOpen;
    panel.classList.toggle("closed", !panelOpen);
    // The FAB is a child of <html> (mounted to survive SPA nav), so the open
    // flag must go on the document element for the `html.chat-open` selectors
    // to reach it. body keeps its own class for the docked-content padding.
    document.documentElement.classList.toggle("chat-open", panelOpen);
    // Docked + closed: suspend the top-frame inset and boundary strip so the
    // page uses the full height while the chat is hidden; the dock intent and
    // saved frame height persist, so reopening restores the docked layout.
    document.documentElement.classList.toggle("chat-docked-closed", !panelOpen && isDocked());
  }
  // Open from the FAB: restore whatever mode it was last in (docked or
  // floating) — the dock state is a visitor setting that survives close.
  function openPanel() {
    if (!panelOpen) togglePanel();
  }
  // Close from the header X / Escape: keep the dock state so reopening
  // restores it (docked: same frame height; floating: same position/size).
  function closePanel() {
    if (panelOpen) togglePanel();
  }

  // ---- Draggable + resizable panel ----
  // The header is the drag handle; the left/top edges resize. Position +
  // size are persisted so the visitor's layout survives a reload.
  var panelPos = { x: null, y: null, w: null, h: null };
  // Responsive minimums so the panel can shrink on a phone:
  //  - width: at least half the screen (a bit more on wider screens, up to 320px)
  //  - height: just enough for header + ~1 message line + input (so a touch user
  //    can resize down to roughly one line of AI response)
  function panelMinW() { return Math.min(320, Math.max(160, Math.round(window.innerWidth * 0.5))); }
  function panelMinH() { return Math.min(180, Math.max(140, Math.round(window.innerHeight * 0.24))); }

  function panelEl() { return document.getElementById("ai-chat-panel"); }
  function clampPanel() {
    var p = panelEl();
    if (!p) return;
    if (isDocked()) return; // docked position is CSS-managed
    var r = p.getBoundingClientRect();
    // The panel is position:fixed, so getBoundingClientRect() (viewport
    // coords) is the exact frame style.left/top uses. offsetLeft/Top are
    // unreliable here (the panel anchors by right/bottom, so they read 0).
    var x = r.left, y = r.top;
    // keep at least 88px visible; don't push off the top edge
    x = Math.max(88 - r.width, Math.min(x, window.innerWidth - 88));
    y = Math.max(0, Math.min(y, window.innerHeight - 70));
    p.style.left = x + "px";
    p.style.top = y + "px";
    p.style.bottom = "auto";
    p.style.right = "auto";
    panelPos.x = x; panelPos.y = y;
    panelPos.w = r.width; panelPos.h = r.height;
  }
  function savePanelGeom() {
    try {
      localStorage.setItem("ai-chat-geom", JSON.stringify({
        x: panelPos.x, y: panelPos.y, w: panelPos.w, h: panelPos.h
      }));
    } catch (e) {}
  }
  function applyPanelGeom() {
    var p = panelEl();
    if (!p) return;
    // A docked panel is a fixed bottom bar (see applyDockState/layoutDockBar)
    // — its position/size are managed there, so nothing to restore here.
    if (isDocked()) return;
    // Only reposition when the visitor has a saved layout; otherwise keep
    // the CSS default (bottom-right / near-full on phones) so first visits
    // are unaffected. (Phones no longer force full-screen, so a saved
    // floating layout is restored there too — clamped to the viewport.)
    if (panelPos.x == null && panelPos.y == null) return;
    var vw = window.innerWidth, vh = window.innerHeight;
    var w = panelPos.w ? Math.min(panelPos.w, vw - 8) : 0;
    var h = panelPos.h ? Math.min(panelPos.h, vh - 8) : 0;
    if (w) p.style.width = w + "px";
    if (h) p.style.height = h + "px";
    p.style.position = "fixed";
    p.style.bottom = "auto";
    p.style.right = "auto";
    if (panelPos.x != null) p.style.left = Math.max(4, Math.min(panelPos.x, vw - 88)) + "px";
    if (panelPos.y != null) p.style.top = Math.max(4, Math.min(panelPos.y, vh - 60)) + "px";
  }
  function isDocked() {
    var p = panelEl();
    return !!(p && p.classList.contains("docked"));
  }
  function restorePanelGeom() {
    try {
      var g = JSON.parse(localStorage.getItem("ai-chat-geom") || "null");
      if (g) {
        panelPos.x = (typeof g.x === "number") ? g.x : null;
        panelPos.y = (typeof g.y === "number") ? g.y : null;
        panelPos.w = (typeof g.w === "number") ? g.w : null;
        panelPos.h = (typeof g.h === "number") ? g.h : null;
      }
    } catch (e) {}
  }
  // ---- Docked mode: a floating bar pinned to the bottom of the SCREEN ----
  // Docking keeps the panel on <html> (so SPA nav never loses it) but makes it
  // a position:fixed bar at the bottom of the viewport — always in view, never
  // scrolled out of sight. It must not cover the sticky sidebars or the
  // article, so a `chat-docked` class on <body> adds matching bottom insets
  // (see styles.css) that push that content up above the bar.
  function setDocked(on) {
    try { localStorage.setItem("ai-chat-docked", on ? "1" : "0"); } catch (e) {}
    applyDockState();
  }
  function applyDockState() {
    var p = panelEl();
    if (!p) return;
    var docked = localStorage.getItem("ai-chat-docked") === "1";
    p.classList.toggle("docked", docked);
    // `chat-docked` on <html> (not <body>): SPA nav REPLACES <body>, so a body
    // class would be lost on navigation. It drives the top-frame inset CSS.
    document.documentElement.classList.toggle("chat-docked", docked);
    document.body.classList.toggle("chat-docked", docked);
    // Docked but currently closed: suspend the inset/strip so the page uses
    // the full height while hidden (see html.chat-docked:not(.chat-open) CSS);
    // the dock intent + saved frame height persist for the next open.
    document.documentElement.classList.toggle("chat-docked-closed", docked && !panelOpen);
    var dockBtn = p.querySelector(".ai-chat-dock");
    if (dockBtn) dockBtn.classList.toggle("active", docked);
    if (docked) {
      // A fixed full-width BOTTOM FRAME — the floating position/size don't apply.
      p.style.left = ""; p.style.top = ""; p.style.bottom = ""; p.style.right = "";
      p.style.width = "";
      applyDockFrameHeight(); // restores the saved boundary position, if any
      addDockStrip(p); // the draggable boundary between the two frames
      layoutDockBar();
    } else {
      removeDockStrip();
      p.style.height = "";
      document.documentElement.style.removeProperty("--dock-h");
      document.body.style.paddingBottom = "";
      applyPanelGeom();
    }
  }
  // ---- Draggable frame boundary (dock mode) ----
  // The strip at the top edge of the bottom frame. Dragging it up makes the AI
  // frame taller (and the content frame shorter); the saved height is a
  // percentage of the viewport so the proportion survives resize + reload.
  var dockStripEl = null;
  var dockSavedVh = null; // e.g. 38 -> 38vh
  function dockMinH() { return 140; }
  function dockMaxH() { return Math.max(300, Math.round(window.innerHeight * 0.9)); }
  function applyDockFrameHeight() {
    var p = panelEl();
    if (!p || !p.classList.contains("docked")) return;
    try {
      var s = parseFloat(localStorage.getItem("ai-chat-dockvh") || "");
      if (isFinite(s) && s > 0) dockSavedVh = Math.min(90, Math.max(12, s));
    } catch (e) {}
    if (dockSavedVh == null) {
      dockSavedVh = 38;
      p.style.height = ""; // CSS default (38vh)
    } else {
      p.style.height = dockSavedVh + "vh";
    }
    document.documentElement.style.setProperty("--dock-h", p.style.height || "38vh");
  }
  // Mounted on <html> (like the panel) so SPA nav keeps it; positioned by the
  // same --dock-h variable the top frame uses for its inset, so the strip is
  // always exactly on the frame boundary.
  function addDockStrip() {
    if (dockStripEl && dockStripEl.parentNode) return;
    dockStripEl = el("div", { id: "ai-chat-frame-boundary", className: "ai-chat-dock-strip", title: "Drag to resize" });
    document.documentElement.appendChild(dockStripEl);
    dockStripEl.addEventListener("pointerdown", function (e) {
      var p = panelEl();
      if (!p || !p.classList.contains("docked")) return;
      if (isPanelGesture()) return;
      e.preventDefault(); e.stopPropagation();
      var sy = e.clientY;
      var sh = p.getBoundingClientRect().height;
      pointerDrag(p, function (ev) {
        // Dragging UP (clientY decreases) makes the AI frame TALLER and the
        // content frame shorter.
        var delta = sy - ev.clientY;
        var nh = Math.min(dockMaxH(), Math.max(dockMinH(), sh + delta));
        p.style.height = nh + "px";
        dockSavedVh = Math.round(100 * nh / window.innerHeight);
        document.documentElement.style.setProperty("--dock-h", nh + "px");
      });
      dockStripEl.addEventListener("pointerup", function done() {
        try { localStorage.setItem("ai-chat-dockvh", String(dockSavedVh)); } catch (e2) {}
        // switch to vh so the saved proportion tracks window resizes
        if (dockSavedVh != null) p.style.height = dockSavedVh + "vh";
        layoutDockBar();
        dockStripEl.removeEventListener("pointerup", done);
      });
    });
  }
  function removeDockStrip() {
    if (dockStripEl && dockStripEl.parentNode) dockStripEl.parentNode.removeChild(dockStripEl);
    dockStripEl = null;
  }
  // Quartz re-renders the page on every SPA nav and REPLACES <body> (wiping the
  // inline padding-bottom we set), so after each nav keep watching for ~1.5s
  // and re-run the bar layout as soon as the NEW page's .center is measurable
  // (idempotent and cheap). Same pattern as buildSidebarToggles.
  function dockReapplySoon() {
    var tries = 0;
    (function poll() {
      var c = document.querySelector("#quartz-body .center");
      if (c && c.getBoundingClientRect().width > 40) {
        layoutDockBar();
      }
      if (tries++ < 90) requestAnimationFrame(poll);
    })();
  }
  document.addEventListener("nav", dockReapplySoon);
  window.addEventListener("popstate", dockReapplySoon);
  // True while a resize/drag gesture is active. Guards other pointer handlers
  // so a stray touch that lands on the panel mid-gesture can't start a second
  // grab or cancel the resize in progress.
  var panelGestureActive = false;
  function isPanelGesture() { return panelGestureActive; }
  function pointerDrag(panel, onMove) {
    var finished = false;
    function end(e) {
      if (finished) return;
      finished = true;
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
      panel.classList.remove("dragging", "resizing");
      panelGestureActive = false;
      document.body.style.userSelect = "";
    }
    function move(e) {
      if (e.cancelable) e.preventDefault();
      onMove(e);
    }
    panelGestureActive = true;
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end);
    // Touch: the browser cancels the pointer when it decides to scroll the
    // page (hijacking the gesture). The handles' `touch-action: none` stops
    // that, but if it still happens, end the gesture cleanly instead of
    // leaving the panel stuck mid-drag.
    document.addEventListener("pointercancel", end);
    panel.classList.add("dragging");
    document.body.style.userSelect = "none";
  }
  function wirePanelDrag() {
    var p = panelEl();
    if (!p || p.__dragWired) return;
    p.__dragWired = true;
    // The panel is position:fixed and anchored by right/bottom by default,
    // so offsetLeft/offsetTop read 0 — getBoundingClientRect() is the true
    // viewport frame and the correct seed for style.left/top math.
    var startFrame = function () {
      var r = p.getBoundingClientRect();
      return { left: r.left, top: r.top, w: r.width, h: r.height };
    };
    var header = p.querySelector(".ai-chat-header");
    if (header) {
      header.addEventListener("pointerdown", function (e) {
        // ignore drags that start on a header button
        if (e.target && e.target.closest && e.target.closest("button")) return;
        if (isDocked()) return; // docked panel isn't movable
        if (isPanelGesture()) return; // a resize/drag is already in progress
        e.preventDefault();
        var s = startFrame();
        var sx = e.clientX, sy = e.clientY;
        panelPos.x = s.left; panelPos.y = s.top;
        panelPos.w = s.w; panelPos.h = s.h;
        pointerDrag(p, function (ev) {
          p.style.left = (s.left + (ev.clientX - sx)) + "px";
          p.style.top = (s.top + (ev.clientY - sy)) + "px";
          p.style.bottom = "auto";
          p.style.right = "auto";
        });
        // clamp + persist once the drag ends
        p.addEventListener("pointerup", function done() {
          clampPanel();
          savePanelGeom();
          p.removeEventListener("pointerup", done);
        });
      });
    }
    // Left edge: horizontal resize (drag left to WIDEN the left side).
    // The panel is anchored by left+top (right/bottom are auto), so changing
    // the width alone would grow the RIGHT edge — we therefore move the left
    // edge by the same amount to keep the right edge fixed.
    var rl = p.querySelector(".ai-chat-resize");
    if (rl) rl.addEventListener("pointerdown", function (e) {
      e.preventDefault(); e.stopPropagation();
      if (isDocked()) return;
      if (isPanelGesture()) return; // a resize/drag is already in progress
      p.classList.add("resizing");
      // Read the frame BEFORE changing insets: with all insets auto a fixed
      // element jumps to its static position, which would corrupt the seed.
      var s = startFrame();
      p.style.left = s.left + "px";
      p.style.top = s.top + "px";
      p.style.right = "auto";
      p.style.bottom = "auto";
      var sx = e.clientX;
      pointerDrag(p, function (ev) {
        var delta = sx - ev.clientX; // >0 when dragging left
        var nw = Math.min(Math.max(panelMinW(), s.w + delta), window.innerWidth - 16);
        p.style.width = nw + "px";
        // Use the RENDERED width (CSS max-width may cap it below nw) so the
        // left edge tracks the real growth, not the requested amount.
        var rw = p.getBoundingClientRect().width;
        p.style.left = (s.left - (rw - s.w)) + "px";
        panelPos.w = rw;
        panelPos.x = parseFloat(p.style.left);
      });
      p.addEventListener("pointerup", function done() {
        p.classList.remove("resizing");
        clampPanel();
        savePanelGeom();
        p.removeEventListener("pointerup", done);
      });
    });
    // Top edge: vertical resize (drag up to TALLER). Same two-edge logic so
    // the bottom edge stays fixed instead of the top one tracking the cursor.
    var rt = p.querySelector(".ai-chat-resize-v");
    if (rt) rt.addEventListener("pointerdown", function (e) {
      e.preventDefault(); e.stopPropagation();
      if (isDocked()) return;
      if (isPanelGesture()) return; // a resize/drag is already in progress
      p.classList.add("resizing");
      var s = startFrame();
      p.style.left = s.left + "px";
      p.style.top = s.top + "px";
      p.style.right = "auto";
      p.style.bottom = "auto";
      var sy = e.clientY;
      pointerDrag(p, function (ev) {
        var delta = sy - ev.clientY; // >0 when dragging up
        var nh = Math.min(Math.max(panelMinH(), s.h + delta), window.innerHeight - 16);
        p.style.height = nh + "px";
        // Use the RENDERED height (CSS max-height may cap it below nh) so the
        // top edge tracks the real growth, not the requested amount.
        var rh = p.getBoundingClientRect().height;
        p.style.top = (s.top - (rh - s.h)) + "px";
        panelPos.h = rh;
        panelPos.y = parseFloat(p.style.top);
      });
      p.addEventListener("pointerup", function done() {
        p.classList.remove("resizing");
        clampPanel();
        savePanelGeom();
        p.removeEventListener("pointerup", done);
      });
    });
    // Right edge: horizontal resize (drag right to WIDER). The left edge is
    // the anchor, so only the width changes.
    var rr = p.querySelector(".ai-chat-resize-r");
    if (rr) rr.addEventListener("pointerdown", function (e) {
      e.preventDefault(); e.stopPropagation();
      if (isDocked()) return;
      if (isPanelGesture()) return; // a resize/drag is already in progress
      p.classList.add("resizing");
      var s = startFrame();
      p.style.left = s.left + "px"; // anchor left so width grows rightward
      p.style.top = s.top + "px";
      p.style.right = "auto";
      p.style.bottom = "auto";
      var sx = e.clientX;
      pointerDrag(p, function (ev) {
        var delta = ev.clientX - sx; // >0 when dragging right
        var nw = Math.min(Math.max(panelMinW(), s.w + delta), window.innerWidth - 16);
        p.style.width = nw + "px";
        panelPos.w = nw;
      });
      p.addEventListener("pointerup", function done() {
        p.classList.remove("resizing");
        clampPanel();
        savePanelGeom();
        p.removeEventListener("pointerup", done);
      });
    });
    // Bottom edge: vertical resize (drag down to TALLER). The top edge is
    // the anchor, so only the height changes.
    var rb = p.querySelector(".ai-chat-resize-h");
    if (rb) rb.addEventListener("pointerdown", function (e) {
      e.preventDefault(); e.stopPropagation();
      if (isDocked()) return;
      if (isPanelGesture()) return; // a resize/drag is already in progress
      p.classList.add("resizing");
      var s = startFrame();
      p.style.left = s.left + "px";
      p.style.top = s.top + "px"; // anchor top so height grows downward
      p.style.right = "auto";
      p.style.bottom = "auto";
      var sy = e.clientY;
      pointerDrag(p, function (ev) {
        var delta = ev.clientY - sy; // >0 when dragging down
        var nh = Math.min(Math.max(panelMinH(), s.h + delta), window.innerHeight - 16);
        p.style.height = nh + "px";
        panelPos.h = nh;
      });
      p.addEventListener("pointerup", function done() {
        p.classList.remove("resizing");
        clampPanel();
        savePanelGeom();
        p.removeEventListener("pointerup", done);
      });
    });
    // Keep on-screen if the window is resized.
    window.addEventListener("resize", clampPanel);
  }

  // ---- Docked bar geometry: span the center article column, never the side panels ----
  // The docked bar is position:fixed (pinned to the bottom of the SCREEN). To
  // keep it from covering the sticky side panels, its left/width are set to
  // exactly the center .center column's box (the article column of the Quartz
  // grid); on single-column layouts (mobile / sidebars hidden) it spans edge
  // to edge. The same measurement drives body's padding-bottom so the
  // article + footer bottom stay clear of the bar.
  var dockBar = { left: null, w: null, h: 0 };
  // Docked frame: always spans the full page width (CSS). This just keeps the
  // --dock-h variable (which insets the top frame) in sync with the frame's
  // actual height, so the top frame's inset tracks resizes of the frame.
  function layoutDockBar() {
    var p = panelEl();
    if (!p || !p.classList.contains("docked")) return;
    var h = p.offsetHeight;
    if (h > 0) document.documentElement.style.setProperty("--dock-h", h + "px");
    dockBar = { left: 0, w: window.innerWidth, h: h };
  }
  window.addEventListener("resize", layoutDockBar);
  window.addEventListener("load", layoutDockBar);

  // ---- Collapsible site side panels (left nav + right rail) ----
  // The site's 3-column Quartz grid keeps the left explorer and right related-
  // pages rail fixed at 320px each, which is a lot on a laptop. These two
  // fixed chevron buttons (mounted on <html> so SPA nav keeps them) collapse
  // the left and/or right column, giving the article the space. State persists.
  function buildSidebarToggles() {
    if (document.getElementById("sidebar-toggle-left")) return;
    var body = function () { return document.getElementById("quartz-body"); };
    function persist() {
      var b = body(); if (!b) return;
      try {
        localStorage.setItem("ai-chat-sidebars", JSON.stringify({
          left: b.classList.contains("no-left"),
          right: b.classList.contains("no-right")
        }));
      } catch (e) {}
    }
    function chevron(dir) {
      return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" ' +
        'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        (dir === "left" ? '<path d="M15 18l-6-6 6-6"/>' : '<path d="M9 18l6-6-6-6"/>') + "</svg>";
    }
    var leftBtn = el("button", {
      id: "sidebar-toggle-left", className: "sidebar-toggle sidebar-toggle-left",
      title: "Toggle side panel", "aria-label": "Toggle left side panel", onclick: function () {
        var b = body(); if (!b) return;
        b.classList.toggle("no-left");
        this.classList.toggle("collapsed", b.classList.contains("no-left"));
        persist();
      }
    });
    leftBtn.innerHTML = chevron("left");
    var rightBtn = el("button", {
      id: "sidebar-toggle-right", className: "sidebar-toggle sidebar-toggle-right",
      title: "Toggle related panel", "aria-label": "Toggle right side panel", onclick: function () {
        var b = body(); if (!b) return;
        b.classList.toggle("no-right");
        this.classList.toggle("collapsed", b.classList.contains("no-right"));
        persist();
      }
    });
    rightBtn.innerHTML = chevron("right");
    document.documentElement.appendChild(leftBtn);
    document.documentElement.appendChild(rightBtn);
    // Reflect saved state + keep chevron direction in sync after a moment.
    function apply() {
      var b = body();
      if (!b) return;
      var left = false, right = false;
      try {
        var s = JSON.parse(localStorage.getItem("ai-chat-sidebars") || "null");
        if (s) { left = !!s.left; right = !!s.right; }
      } catch (e) {}
      b.classList.toggle("no-left", left);
      b.classList.toggle("no-right", right);
      leftBtn.classList.toggle("collapsed", left);
      rightBtn.classList.toggle("collapsed", right);
    }
    // The 3-column body is re-rendered on every SPA nav, which drops the
    // collapse classes. The "nav" event can fire BEFORE the new body is in
    // place, so just re-apply on it once isn't enough — keep watching for
    // ~1.5s and re-apply every time a fresh body element appears (apply() is
    // idempotent and cheap).
    function reapplySoon() {
      var seen = {}, tries = 0;
      (function poll() {
        var b = document.getElementById("quartz-body");
        if (b && !seen[b]) { seen[b] = true; apply(); }
        if (tries++ < 90) requestAnimationFrame(poll);
      })();
    }
    document.addEventListener("nav", reapplySoon);
    window.addEventListener("popstate", reapplySoon);
    apply();
  }

  // ---- Build UI (mount on <html> so SPA navigation keeps it) ----
  function buildUI() {
    if (document.getElementById("ai-chat-fab")) return;

    var fab = el("button", {
      id: "ai-chat-fab",
      className: "ai-chat-fab",
      title: "Open AI Chat Assistant",
      "aria-label": "Open the AI chat assistant",
      "aria-expanded": "false",
      onclick: openPanel
    });
    // Single chat-bubble icon: the FAB only OPENS the panel (it hides while
    // open); closing is the small X in the panel header, plus Escape.
    fab.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" ' +
      'stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.5 0-2.9-.4-4.1-1L3 20l1.1-4.3A8.5 8.5 0 1 1 21 11.5z"/></svg>';
    document.documentElement.appendChild(fab);

    var panel = el("div", { id: "ai-chat-panel", className: "ai-chat-panel closed" });

    // (Saved position/size are restored after the panel is appended to the
    // document — getElementById can't see it before then.)

    // Resize handles: all four edges. Left/top are "anchored" edges (dragging
    // them moves that edge + size); right/bottom are "free" edges (dragging
    // them just changes the size).
    panel.appendChild(el("div", { className: "ai-chat-resize", title: "Drag to resize width" }));
    panel.appendChild(el("div", { className: "ai-chat-resize-v", title: "Drag to resize height" }));
    panel.appendChild(el("div", { className: "ai-chat-resize-r", title: "Drag to resize width" }));
    panel.appendChild(el("div", { className: "ai-chat-resize-h", title: "Drag to resize height" }));

    var header = el("div", { className: "ai-chat-header", title: "Drag to move" });
    // The provider status (state dot + "Model (where it runs)") is the header
    // title now — one line instead of a title line plus a separate status bar.
    var status = el("div", { className: "ai-chat-status", title: "AI model & provider" });
    status.appendChild(el("span", { id: "ai-chat-status-dot", className: "status-dot" }));
    status.appendChild(el("span", { id: "ai-chat-status-text", textContent: "Starting\u2026" }));
    header.appendChild(status);
    var actions = el("div", { className: "ai-chat-header-actions" });
    actions.appendChild(el("button", { title: "Settings", textContent: "\u2699\uFE0F", onclick: openSettings }));
    // Inline SVG (not an emoji): emoji rendering depends on the OS emoji
    // font, which is exactly what made the clear button look broken.
    var clearBtn = el("button", { title: "Clear chat", onclick: clearChat, "aria-label": "Clear chat" });
    clearBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" ' +
      'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/>' +
      '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>' +
      '<path d="M10 11v6M14 11v6"/></svg>';
    actions.appendChild(clearBtn);
    // Dock: pin the chat as a floating bar at the bottom of the SCREEN (never
    // scrolled out of sight), spanning only the center article column so it
    // can't cover the side panels; body gains matching bottom padding so the
    // article/footer clear it. Toggle again to undock.
    var dockBtn = el("button", {
      title: "Dock chat to the bottom of the screen",
      "aria-label": "Dock chat to the bottom of the screen",
      className: "ai-chat-dock",
      onclick: function () { setDocked(!isDocked()); }
    });
    dockBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" ' +
      'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 3v8"/><path d="M8 7l4 4 4-4"/><path d="M4 15h16v6H4z"/></svg>';
    actions.appendChild(dockBtn);
    // Close (X) button — top-right of the header. Small and inline (not the
    // big FAB), matching the other header icon buttons.
    var closeBtn = el("button", {
      title: "Close chat",
      "aria-label": "Close chat",
      className: "ai-chat-close",
      onclick: closePanel
    });
    closeBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M6 6l12 12M18 6L6 18"/></svg>';
    actions.appendChild(closeBtn);
    header.appendChild(actions);
    panel.appendChild(header);


    var msgBox = el("div", { id: "ai-chat-messages", className: "ai-chat-messages" });
    panel.appendChild(msgBox);
    // The panel isn't in the DOM yet (appended at the end of buildUI), so
    // getElementById would return null — pass the reference directly.
    attachLinkQrHover(msgBox);

    var inputArea = el("div", { className: "ai-chat-input-area" });
    var textarea = el("textarea", {
      id: "ai-chat-input",
      placeholder: "Ask a question about CityUHK CS admission\u2026",
      rows: "1"
    });
    textarea.dataset.ph = textarea.placeholder;
    // If the visitor tabs/clicks into the input while the panel is closed
    // (e.g. it was miniaturised), open it so typing works.
    textarea.addEventListener("focus", function () {
      var p = document.getElementById("ai-chat-panel");
      if (p && p.classList.contains("closed")) togglePanel();
    });
    textarea.addEventListener("input", function () {
      this.style.height = "auto";
      this.style.height = Math.min(this.scrollHeight, 120) + "px";
    });
    textarea.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    inputArea.appendChild(textarea);
    inputArea.appendChild(el("button", {
      id: "ai-chat-send",
      textContent: "\u27A4",
      onclick: sendMessage
    }));
    panel.appendChild(inputArea);

    document.documentElement.appendChild(panel);

    // Restore the visitor's saved position/size now that the panel is in the
    // document (applyPanelGeom reads it via getElementById). If they had the
    // chat docked, applyDockState() moves it into the page grid instead.
    restorePanelGeom();
    applyDockState();

    // Wire drag/resize now that the panel is in the document.
    wirePanelDrag();
    // Collapsible left/right site side panels.
    buildSidebarToggles();

    // "Share this page" QR card in the right sidebar (full published URL).
    // buildSidebarQr also wires its own per-nav re-injection + URL re-target.
    buildSidebarQr();
  }

  // ---- Debug / test hook (harmless in production) ----
  window.__aiChatDebug = {
    setEngine: function (e, modelId) {
      engine = e;
      if (modelId) currentModelId = modelId;
      if (e) clearEndpointCfg(); // a real in-browser engine supersedes external
    },
    setExternal: function (cfg) { saveEndpointCfg(cfg); },
    getExternal: function () { return endpointCfg(); },
    getModel: function () { return currentModelId; },
    history: function () { return conversationHistory.slice(); },
    tools: TOOLS,
    // Headless testing: run any registered tool by name; returns a promise.
    callTool: function (name, args) { return executeTool(name, args || {}, {}); }
  };

  // ---- Init ----
  function init() {
    buildUI();
    showWelcome();
    loadKnowledgeIndex();
    // Escape closes the panel (when open) — the header X does the same.
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && panelOpen) closePanel();
    });

    // ---- Ask-the-AI question list (cover page) ----
    // Each .ask-ai-list <li> is tap-to-ask: the click opens the chat and
    // sends the question straight away, so a student never has to retype it.
    // Event delegation (on document, not the <li>s) keeps this working across
    // SPA navigation, where the morph router replaces the article content and
    // any per-item listeners would be destroyed.
    document.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target : null;
      var li = t ? t.closest(".ask-ai-list li") : null;
      if (!li) return;
      e.preventDefault();
      var q = (li.textContent || "").replace(/\s+/g, " ").trim();
      if (!q) return;
      if (!panelOpen) togglePanel();
      var inputEl = document.getElementById("ai-chat-input");
      if (!inputEl) return;
      // Brief visual confirmation on the tapped question.
      li.classList.add("asked");
      setTimeout(function () { li.classList.remove("asked"); }, 1200);
      inputEl.value = q;
      sendMessage();
    });
    var savedCfg = endpointCfg();
    var savedModel = storageGetModel();
    if (savedCfg && savedCfg.kind === "external") {
      // Visitor explicitly configured their own server -> it wins.
      activateExternal();
    } else if (savedModel) {
      // Visitor explicitly loaded an in-browser model -> it wins.
      loadEngine(savedModel);
    } else {
      // No explicit choice: try the site-provided "free" provider. If it's
      // up and the key works, visitors get free answers with zero setup.
      // If not (disabled / key revoked / offline), fall back to the
      // normal "open settings and configure" prompt.
      setStatus("loading", "Checking free AI service\u2026");
      loadFreeConfig().then(function () {
        if (isFree()) activateFree();
        else setStatus("idle", "Open \u2699 settings to load a model or connect a server");
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
// (single IIFE wrapper is added by index.js around tools.js + this file)

})()
