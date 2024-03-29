var cubeStrip = [
    0, 1, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 1, 0, 0,
    0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 0, 1, 0, 0,
];
var container = null;
var vertices = null;
var isBlackBackColor = true;
var gl = null;
var isDrawOnDemand = false;
var canvas = null;
var shader = null;

var epiShader = null;
var coord = null;
var projV = null;
var vScale = null;

var blurShader = null;
var sobelShader = null;
var volumeTexture = null;
var gradientTexture = null;
var colormap = null;
var proj = null;
var vao = null;
var vbo = null;
//var tex = null;
var camera = null;
var projView = null;
var newVolumeUpload = true;
var targetFrameTime = 32;
var samplingRate = 1.0;
var WIDTH = 570;
var HEIGHT = 570;
canvas = document.getElementById("glcanvas");
var hdr;
var img;
var colorName = "";
var colorOpacity = 2;
const center = vec3.set(vec3.create(), 0.5, 0.5, 0.5);

document.addEventListener("keydown", function (evt) {
    if (evt.key == "z") adjustOpacity(0.9);
    if (evt.key == "a") adjustOpacity(1.1);
    if (evt.key == "w") adjustQuality(1.1);
    if (evt.key == "q") adjustQuality(0.9);
});
if (isDrawOnDemand)
    document.addEventListener("cameraRedraw", (e) => glDraw());

function adjustQuality(scale) {
    samplingRate = samplingRate * scale;
    samplingRate = Math.min(samplingRate, 10.0);
    samplingRate = Math.max(samplingRate, 0.7);
    gl.uniform1f(shader.uniforms["dt_scale"], samplingRate);
    console.log("quality ", samplingRate);
    if (isDrawOnDemand) glDraw();
}

function adjustOpacity(scale) {
    colorOpacity = colorOpacity * scale;
    colorOpacity = Math.min(colorOpacity, 10.0);
    colorOpacity = Math.max(colorOpacity, 0.1);
    selectColormap(colorName);
    console.log("opacity ", colorOpacity);
    if (isDrawOnDemand) glDraw();
}

var loadVolume = function (url, isURL, onload) {
    console.log('actual load volume function')
    if (!isURL) {
        var reader = new FileReader();
        reader.readAsArrayBuffer(url);
        reader.addEventListener("load", function (event) {
            console.log(event.target.result);
            //loadGeometryCore(object, isOverlay);
            var hdr = nifti.readHeader(event.target.result);
            var img;
            if (nifti.isCompressed(event.target.result)) {
                img = nifti.readImage(hdr, nifti.decompress(event.target.result));
            } else img = nifti.readImage(hdr, event.target.result);
            //img = new Uint8Array(img);
            onload(url, hdr, img);
        });
        return;
    }
    var req = new XMLHttpRequest();
    req.open("GET", url, true);
    req.responseType = "arraybuffer";
    req.onprogress = function (evt) {
        //loadingProgressBar.setAttribute("style", "width: " + percent.toFixed(2) + "%");
    };
    req.onerror = function (evt) {
        console.log = "Error Loading Volume";
    };
    req.onload = function (evt) {
        var dataBuffer = req.response;
        if (dataBuffer) {
            var hdr = nifti.readHeader(dataBuffer);
            var img;
            if (nifti.isCompressed(dataBuffer)) {
                img = nifti.readImage(hdr, nifti.decompress(dataBuffer));
            } else img = nifti.readImage(hdr, dataBuffer);
            //img = new Uint8Array(img);
            onload(url, hdr, img);
        } else {
            alert("Unable to load buffer properly from volume?");
            console.log("no buffer?");
        }
    };
    req.send();
}; //loadVolume()

function bindBlankGL() {
    console.log('bind blank gl')
    let texR = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, texR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texStorage3D(
        gl.TEXTURE_3D,
        1,
        gl.RGBA8,
        hdr.dims[1],
        hdr.dims[2],
        hdr.dims[3]
    );
    return texR;
}

function gradientGL() {
    console.log('gradient gl')
    var faceStrip = [0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0];
    var vao2 = gl.createVertexArray();
    gl.bindVertexArray(vao2);
    vbo2 = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo2);
    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(faceStrip),
        gl.STATIC_DRAW
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    var fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.disable(gl.CULL_FACE);
    gl.viewport(0, 0, hdr.dims[1], hdr.dims[2]);
    gl.disable(gl.BLEND);
    tempTex3D = bindBlankGL();
    blurShader.use();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.uniform1i(blurShader.uniforms["intensityVol"], 1);
    gl.uniform1f(blurShader.uniforms["dX"], 0.7 / hdr.dims[1]);
    gl.uniform1f(blurShader.uniforms["dY"], 0.7 / hdr.dims[2]);
    gl.uniform1f(blurShader.uniforms["dZ"], 0.7 / hdr.dims[3]);

    gl.bindVertexArray(vao2);
    for (i = 0; i < hdr.dims[3] - 1; i++) {
        var coordZ = (1 / hdr.dims[3]) * (i + 0.5);
        gl.uniform1f(blurShader.uniforms["coordZ"], coordZ);
        gl.framebufferTextureLayer(
            gl.FRAMEBUFFER,
            gl.COLOR_ATTACHMENT0,
            tempTex3D,
            0,
            i
        );
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, faceStrip.length / 3);
    }

    sobelShader.use();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, tempTex3D); //input texture
    gl.uniform1i(sobelShader.uniforms["intensityVol"], 1);
    gl.uniform1f(sobelShader.uniforms["dX"], 0.7 / hdr.dims[1]);
    gl.uniform1f(sobelShader.uniforms["dY"], 0.7 / hdr.dims[2]);
    gl.uniform1f(sobelShader.uniforms["dZ"], 0.7 / hdr.dims[3]);
    gl.uniform1f(sobelShader.uniforms["coordZ"], 0.5);
    gl.bindVertexArray(vao2);
    gl.activeTexture(gl.TEXTURE0);
    if (gradientTexture !== null) gl.deleteTexture(gradientTexture);
    gradientTexture = bindBlankGL();
    for (i = 0; i < hdr.dims[3] - 1; i++) {
        var coordZ = (1 / hdr.dims[3]) * (i + 0.5);
        gl.uniform1f(sobelShader.uniforms["coordZ"], coordZ);
        //console.log(coordZ);
        gl.framebufferTextureLayer(
            gl.FRAMEBUFFER,
            gl.COLOR_ATTACHMENT0,
            gradientTexture,
            0,
            i
        );
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, faceStrip.length / 3);
    }
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(tempTex3D);
    //return to volume rendering shader
    shader.use();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, volumeTexture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_3D, gradientTexture);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
}

function glDraw() {
    // console.log('brain gl draw')
    shader.use()
    gl.uniform1f(shader.uniforms["dt_scale"], samplingRate);
    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    projView = mat4.mul(projView, proj, camera.camera);
    gl.uniformMatrix4fv(shader.uniforms["proj_view"], false, projView);
    //var eye = [camera.invCamera[12], camera.invCamera[13], camera.invCamera[14]];
    var eye = camera.eyePos();
    gl.uniform3fv(shader.uniforms["eye_pos"], eye);
    //Lighting
    //"Head-light" with light at camera location:
    //gl.uniform3fv(shader.uniforms["light_pos"], eye);
    //we will place a light directly above the camera, mixing headlight with top light
    var mx = Math.max(Math.abs(...eye));
    up = camera.upDir();
    var light = eye;
    light[0] = eye[0] + up[0] * mx;
    light[1] = eye[1] + up[1] * mx;
    light[2] = eye[2] + up[2] * mx;
    gl.uniform3fv(shader.uniforms["light_pos"], light);
    //draw cube
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, cubeStrip.length / 3);


    // electrode
    epiShader.use()

    gl.uniformMatrix4fv(projV, false, projView);
    gl.uniform3fv(vScale, [1, 1, 1]);

    // Point an attribute to the currently bound VBO
    gl.vertexAttribPointer(coord, 3, gl.FLOAT, false, 0, 0);

    // Enable the attribute
    gl.enableVertexAttribArray(coord);

    // Draw the triangle
    // console.log(vertices.length / 3)
    gl.drawArrays(gl.POINTS, 0, vertices.length / 3);

    // callElectrodeProgram();
    // Wait for rendering to actually finish
    gl.finish();

}

function updateVolume() {
    console.log('update volume')
    //load volume or change contrast
    //convert data to 8-bit image
    vox = hdr.dims[1] * hdr.dims[2] * hdr.dims[3];
    img8 = new Uint8Array(vox);
    if (hdr.datatypeCode === 2)
        //data already uint8
        imgRaw = new Uint8Array(img);
    else if (hdr.datatypeCode === 4) var imgRaw = new Int16Array(img);
    else if (hdr.datatypeCode === 16) var imgRaw = new Float32Array(img);
    else if (hdr.datatypeCode === 512) var imgRaw = new Uint16Array(img);
    mn = hdr.cal_min;
    mx = hdr.cal_max;
    var scale = 1;
    if (mx > mn) scale = 255 / (mx - mn);
    for (i = 0; i < vox - 1; i++) {
        v = imgRaw[i];
        v = v * hdr.scl_slope + hdr.scl_inter;
        if (v < mn) img8[i] = 0;
        else if (v > mx) img8[i] = 255;
        else img8[i] = (v - mn) * scale;
    }
    tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texStorage3D(
        gl.TEXTURE_3D,
        1,
        gl.R8,
        hdr.dims[1],
        hdr.dims[2],
        hdr.dims[3]
    );
    gl.texSubImage3D(
        gl.TEXTURE_3D,
        0,
        0,
        0,
        0,
        hdr.dims[1],
        hdr.dims[2],
        hdr.dims[3],
        gl.RED,
        gl.UNSIGNED_BYTE,
        img8
    );
    var longestAxis = Math.max(
        hdr.dims[1],
        Math.max(hdr.dims[2], hdr.dims[3])
    );
    var volScale = [
        hdr.dims[1] / longestAxis,
        hdr.dims[2] / longestAxis,
        hdr.dims[3] / longestAxis,
    ];

    // console.log(gl.getParameter(gl.CURRENT_PROGRAM))
    shader.use();
    var vdims = gl.getUniformLocation(shader.program, "volume_dims");
    var volDims = [
        hdr.dims[1],
        hdr.dims[2],
        hdr.dims[3],
    ]
    gl.uniform3iv(vdims, volDims);

    console.log(volScale, volDims, longestAxis)
    gl.uniform3fv(shader.uniforms["volume_scale"], [1, 1, 1]);
    newVolumeUpload = true;
    //gradientGL();
    if (!volumeTexture) {
        volumeTexture = tex;
        if (isDrawOnDemand);
        else {
            //glDraw();
            setInterval(function () {
                shader.use()
                // Save them some battery if they're not viewing the tab
                if (document.hidden) {
                    return;
                }
                var startTime = new Date();
                // Reset the sampling rate and camera for new volumes
                if (newVolumeUpload) {
                    onWindowResize();
                    samplingRate = 1.0;
                    gl.uniform1f(shader.uniforms["dt_scale"], samplingRate);
                }
                glDraw();
                var endTime = new Date();
                var renderTime = endTime - startTime;
                var targetSamplingRate = renderTime / targetFrameTime;
                // if (takeScreenShot) {
                //     takeScreenShot = false;
                //     canvas.toBlob(function (b) {
                //         saveAs(b, "screen.png");
                //     }, "image/png");
                // }
                // If we're dropping frames, decrease the sampling rate
                if (!newVolumeUpload && targetSamplingRate > samplingRate) {
                    samplingRate = 0.8 * samplingRate + 0.2 * targetSamplingRate;
                    gl.uniform1f(shader.uniforms["dt_scale"], samplingRate);
                }
                newVolumeUpload = false;
                startTime = endTime;
            }, targetFrameTime);
        }
    } else {
        gl.deleteTexture(volumeTexture);
        volumeTexture = tex;
        if (isDrawOnDemand) glDraw();
    }
    gradientGL();
    glDraw();
} //updateVolume()

var selectVolume = function (url, isURL = true) {
    console.log('select volume')
    loadVolume(url, isURL, function (file, xhdr, ximg) {
        console.log('load volume')
        hdr = xhdr;
        img = ximg;
        console.log(img)
        //determine range
        var imgRaw;
        if (hdr.datatypeCode === 2)
            //data already uint8
            imgRaw = new Uint8Array(img);
        else if (hdr.datatypeCode === 4)
            //Int16
            imgRaw = new Int16Array(img);
        else if (hdr.datatypeCode === 16)
            //Float32
            imgRaw = new Float32Array(img);
        else if (hdr.datatypeCode === 512)
            //UInt16
            imgRaw = new Uint16Array(img);
        else {
            alert("Unsupported data type");
            console.log("Unsupported data type %d", hdr.datatypeCode);
            var e = new Error("Unsupported data type", hdr.datatypeCode);
            throw e;
        }
        var vox = imgRaw.length;
        var mn = Infinity;
        var mx = -Infinity;
        for (i = 0; i < vox - 1; i++) {
            if (!isFinite(imgRaw[i])) continue;
            if (imgRaw[i] < mn) mn = imgRaw[i];
            if (imgRaw[i] > mx) mx = imgRaw[i];
        }
        //calibrate intensity
        if (
            isFinite(hdr.scl_slope) &&
            isFinite(hdr.scl_inter) &&
            hdr.scl_slope !== 0.0
        ) {
            // console.log(">> mn %f mx %f %f %f", mn, mx, hdr.scl_slope, hdr.scl_inter);
            mn = mn * hdr.scl_slope + hdr.scl_inter;
            mx = mx * hdr.scl_slope + hdr.scl_inter;
        } else {
            hdr.scl_slope = 1.0;
            hdr.scl_inter = 0.0;
        }
        // console.log("vx %d type %d mn %f mx %f", vox, hdr.datatypeCode, mn, mx);
        // console.log("cal mn..mx %f..%f", hdr.cal_min, hdr.cal_max);
        hdr.global_min = mn;
        hdr.global_max = mx;
        if (
            !isFinite(hdr.cal_min) ||
            !isFinite(hdr.cal_max) ||
            hdr.cal_min >= hdr.cal_max
        ) {
            hdr.cal_min = mn;
            hdr.cal_max = mx;
        }
        // console.log(hdr)
        updateVolume();
    });
}; // selectVolume()

/* called from select colormap */
function makeLut(Rs, Gs, Bs, As, Is) {
    //create color lookup table provided arrays of reds, greens, blues, alphas and intensity indices
    //intensity indices should be in increasing order with the first value 0 and the last 255.
    // makeLut([0, 255], [0, 0], [0,0], [0,128],[0,255]); //red gradient
    var lut = new Uint8Array(256 * 4);
    for (i = 0; i < Is.length - 1; i++) {
        //return a + f * (b - a);
        var idxLo = Is[i];
        var idxHi = Is[i + 1];
        var idxRng = idxHi - idxLo;
        var k = idxLo * 4;
        for (j = idxLo; j <= idxHi; j++) {
            var f = (j - idxLo) / idxRng;
            lut[k] = Rs[i] + f * (Rs[i + 1] - Rs[i]); //Red
            k++;
            lut[k] = Gs[i] + f * (Gs[i + 1] - Gs[i]); //Green
            k++;
            lut[k] = Bs[i] + f * (Bs[i + 1] - Bs[i]); //Blue
            k++;
            lut[k] = (As[i] + f * (As[i + 1] - As[i])) * colorOpacity; //Alpha
            k++;
        }
    }
    return lut;
} // makeLut()

var selectColormap = function (lutName) {
    console.log('colormap')
    var lut = makeLut([0, 255], [0, 255], [0, 255], [0, 128], [0, 255]); //gray
    if (lutName === "Plasma")
        lut = makeLut(
            [13, 156, 237, 240],
            [8, 23, 121, 249],
            [135, 158, 83, 33],
            [0, 56, 80, 88],
            [0, 64, 192, 255]
        ); //plasma
    if (lutName === "Viridis")
        lut = makeLut(
            [68, 49, 53, 253],
            [1, 104, 183, 231],
            [84, 142, 121, 37],
            [0, 56, 80, 88],
            [0, 65, 192, 255]
        ); //viridis
    if (lutName === "Inferno")
        lut = makeLut(
            [0, 120, 237, 240],
            [0, 28, 105, 249],
            [4, 109, 37, 33],
            [0, 56, 80, 88],
            [0, 64, 192, 255]
        ); //inferno
    colorName = lutName;
    if (colormap !== null) gl.deleteTexture(colormap); //release colormap');
    colormap = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, colormap);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 256, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        256,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        lut
    );
}; // selectColormap()

window.onload = function () {
    console.log("window on load")
    gl = canvas.getContext("webgl2");
    if (!gl) {
        alert("Unable to initialize WebGL2. Your browser may not support it");
        return;
    }

    window.addEventListener("resize", onWindowResize, false);
    onWindowResize(true);

    // Register mouse and touch listeners
    var controller = new Controller();
    controller.mousemove = function (prev, cur, evt) {
        if (evt.buttons == 1) {
            camera.rotate(prev, cur);
        } else if (evt.buttons == 2) {
            camera.pan([cur[0] - prev[0], prev[1] - cur[1]]);
        }
    };
    controller.wheel = function (amt) {
        camera.zoom(amt);
    };
    controller.pinch = controller.wheel;
    controller.twoFingerDrag = function (drag) {
        camera.pan(drag);
    };
    controller.registerForCanvas(canvas);

    // Setup required OpenGL state for drawing the back faces and
    // composting with the background color
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    //gl.clearColor(1, 0.5, 0.5, 3);

    callBrainProgram();
    callElectrodeProgram();
    // callBrainProgram();
}; // window.onload()

function callElectrodeProgram() {
    console.log('electrode program')

    // var vertShader = createShaderEpi(gl, gl.VERTEX_SHADER, vertCode);
    // var fragShader = createShaderEpi(gl, gl.FRAGMENT_SHADER, fragCode);
    // var program = createProgramEpi(gl, vertShader, fragShader)

    // gl.useProgram(program)

    epiShader = new Shader(verEpi, fragEpi)
    // console.log(epiShader)
    epiShader.use()

    coord = gl.getAttribLocation(epiShader.program, "coordinates");
    projV = gl.getUniformLocation(epiShader.program, 'uView')
    vScale = gl.getUniformLocation(epiShader.program, 'volume_scale')

    vertices = [0, 0, 0,
        61.7397994995117, 139.014129638672, 178.866790771484,
        57.0425949096680, 139.287994384766, 172.553298950195,
        52.6332588195801, 139.174285888672, 168.291290283203,
        49.9343223571777, 139.158569335938, 163.294281005859,
        47.0855522155762, 139.024169921875, 158.372970581055,
        58.0416793823242, 131.243377685547, 179.853149414063,
        53.8179206848145, 130.746154785156, 173.396087646484,
        50.9673805236816, 130.553924560547, 168.459442138672,
        48.1004180908203, 130.171569824219, 163.658401489258,
        47.0327911376953, 130.298995971680, 158.395172119141,
        44.5878067016602, 152.413452148438, 127.619720458984,
        46.5737419128418, 153.781738281250, 122.439125061035,
        50.5636215209961, 155.926162719727, 118.359619140625,
        54.1101531982422, 157.709716796875, 113.420326232910,
        60.9065780639648, 159.683746337891, 110.268630981445,
        45.3121032714844, 142.812438964844, 126.440490722656,
        49.4790573120117, 145.072082519531, 121.394447326660,
        50.6709136962891, 147.108184814453, 117.142639160156,
        54.8323822021484, 149.705718994141, 112.750564575195,
        60.2906494140625, 149.689758300781, 109.682693481445
    ];

    // Create an empty buffer object to store vertex buffer
    var vertex_buffer = gl.createBuffer();
    // Bind appropriate array buffer to it
    gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer);
    // Pass the vertex data to the buffer
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    // Unbind the buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    // console.log(new Int16Array(vertices))
    // Bind vertex buffer object
    gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer);


}

function callBrainProgram() {
    console.log("brain program")
    sobelShader = new Shader(blurVertShader, sobelFragShader);
    sobelShader.use();
    blurShader = new Shader(blurVertShader, blurFragShader);
    blurShader.use();

    // Setup VAO and VBO to render the cube to run the raymarching shader
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(cubeStrip),
        gl.STATIC_DRAW
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);



    setShader(1); //Lighting shader


    // Load the default colormap and upload it, after which we
    // load the default volume.
    selectColormap("Gray");
    // selectVolume("spmSmall.nii.gz");
    selectVolume("primary.nii.gz");
}

function setShader(shaderInt) {
    console.log('set shader')
    //0=default, 1=lighting, 2=Maximum Intensity
    if (shaderInt === 3) shader = new Shader(vertShader, fragShaderGradients);
    else if (shaderInt === 2) shader = new Shader(vertShader, fragShaderMIP);
    else if (shaderInt === 1)
        shader = new Shader(vertShader, fragShaderLighting);
    else shader = new Shader(vertShader, fragShader);
    shader.use();
    // console.log(shader.uniforms)
    gl.uniform1i(shader.uniforms["volume"], 0);
    gl.uniform1i(shader.uniforms["colormap"], 1);
    gl.uniform1i(shader.uniforms["gradients"], 2);
    gl.uniform1f(shader.uniforms["dt_scale"], 1.0);
}

/* window resize handler */
function onWindowResize(isInit = false) {
    WIDTH = canvas.clientWidth;
    HEIGHT = canvas.clientHeight; //menuHeight;
    // Check if the canvas is not the same size.
    if (canvas.width != WIDTH || canvas.height != HEIGHT) {
        // Make the canvas the same size
        canvas.width = WIDTH;
        canvas.height = HEIGHT;
        //console.log("<< %s  %s", WIDTH, HEIGHT);
    }
    //https://webglfundamentals.org/webgl/lessons/webgl-resizing-the-canvas.html
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    proj = mat4.perspective(
        mat4.create(),
        (15 * Math.PI) / 180.0,
        WIDTH / HEIGHT,
        0.1,
        100
    );
    camera = new ArcballCamera(center, 2, [WIDTH, HEIGHT]);
    projView = mat4.create();
    const kRot = Math.sqrt(0.5);
    camera.rotateY([0.0, kRot]);
    camera.rotateY([kRot, 0.0]);
    //if (isInit) return;
    //samplingRate = 1.0;
    //gl.uniform1f(shader.uniforms["dt_scale"], samplingRate);
    if (shader !== null && isDrawOnDemand) glDraw();
} //onWindowResize()